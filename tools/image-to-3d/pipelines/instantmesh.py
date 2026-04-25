"""InstantMesh pipeline — Apache 2.0 multi-view fusion (Phase 3.5).

Upstream: https://github.com/TencentARC/InstantMesh (Apache 2.0).

Two stages:
  1. Zero123++ (`sudo-ai/zero123plus-v1.2`) generates 6 multi-view images
     from a single input view. Loaded with InstantMesh's custom
     white-background UNet checkpoint on top.
  2. The LRM transformer (`TencentARC/InstantMesh`) fuses the 6 views into
     triplane features and extracts a vertex-colored mesh via FlexiCubes.

VRAM strategy on the target RTX 2000 Ada (8 GB):
  - Stage 1 (Zero123++ at fp16): ~4 GB on device.
  - Stage 2 (LRM transformer): ~6 GB on device.
  - Sequential offload — diffusion is moved back to CPU between stages so
    peak VRAM = max(stage1, stage2), not the sum.

Vertex-color output only. Textured/UV-mapped output goes through
``nvdiffrast`` (Windows wheel pain) and is deferred to a future spec.

First call downloads ~6.5 GB of weights into ``~/.cache/huggingface/``:
  - TencentARC/InstantMesh (~5 GB) — UNet + LRM ckpt.
  - sudo-ai/zero123plus-v1.2 (~1.5 GB) — base diffusion model.

Run ``python convert.py --prefetch-weights instantmesh`` to download these
ahead of time.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import Any, ClassVar, Optional

import numpy as np
import trimesh
from PIL import Image

from .base import Pipeline

_LOG = logging.getLogger(__name__)

_INSTANTMESH_DIR = Path(__file__).resolve().parent.parent / "external" / "InstantMesh"
if _INSTANTMESH_DIR.is_dir() and str(_INSTANTMESH_DIR) not in sys.path:
    sys.path.insert(0, str(_INSTANTMESH_DIR))


DEFAULT_CONFIG = "instant-mesh-large"
DEFAULT_DIFFUSION_STEPS = 75
DEFAULT_SCALE = 1.0
DEFAULT_SEED = 42
ZERO123PLUS_REPO = "sudo-ai/zero123plus-v1.2"
INSTANTMESH_REPO = "TencentARC/InstantMesh"


class InstantMeshPipeline(Pipeline):
    """Two-stage Zero123++ → LRM pipeline producing vertex-colored meshes."""

    name: ClassVar[str] = "instantmesh"

    # Singletons across calls within one process — same caching pattern as
    # TripoSRPipeline. Keyed by (config_name, device) so a second call with
    # different settings reloads correctly instead of silently reusing a
    # mismatched model.
    _diffusion: ClassVar[Optional[Any]] = None
    _model: ClassVar[Optional[Any]] = None
    _model_config_name: ClassVar[Optional[str]] = None
    _device: ClassVar[Optional[str]] = None

    def __init__(
        self,
        config_name: str = DEFAULT_CONFIG,
        diffusion_steps: int = DEFAULT_DIFFUSION_STEPS,
        scale: float = DEFAULT_SCALE,
        seed: int = DEFAULT_SEED,
        device: Optional[str] = None,
    ) -> None:
        self.config_name = config_name
        self.diffusion_steps = diffusion_steps
        self.scale = scale
        self.seed = seed
        self.device = device or self._pick_device()

    @staticmethod
    def _pick_device() -> str:
        import torch

        return "cuda:0" if torch.cuda.is_available() else "cpu"

    def _config_path(self) -> Path:
        path = _INSTANTMESH_DIR / "configs" / f"{self.config_name}.yaml"
        if not path.is_file():
            raise FileNotFoundError(
                f"InstantMesh config not found: {path}. "
                "Run `python install_instantmesh.py` to vendor the upstream tree."
            )
        return path

    def _load_diffusion(self):
        """Load (or return cached) Zero123++ pipeline with InstantMesh's UNet."""
        if InstantMeshPipeline._diffusion is not None:
            return InstantMeshPipeline._diffusion

        import torch
        from diffusers import DiffusionPipeline, EulerAncestralDiscreteScheduler
        from huggingface_hub import hf_hub_download

        _LOG.info("loading Zero123++ diffusion pipeline (fp16) …")
        load_start = time.perf_counter()

        pipeline = DiffusionPipeline.from_pretrained(
            ZERO123PLUS_REPO,
            custom_pipeline="zero123plus",
            torch_dtype=torch.float16,
        )
        pipeline.scheduler = EulerAncestralDiscreteScheduler.from_config(
            pipeline.scheduler.config, timestep_spacing="trailing"
        )

        # InstantMesh trains its own white-background UNet on top of the
        # base Zero123++ — swap the weights in.
        unet_ckpt = hf_hub_download(
            repo_id=INSTANTMESH_REPO,
            filename="diffusion_pytorch_model.bin",
            repo_type="model",
        )
        state_dict = torch.load(unet_ckpt, map_location="cpu")
        pipeline.unet.load_state_dict(state_dict, strict=True)

        InstantMeshPipeline._diffusion = pipeline
        _LOG.info(
            "Zero123++ ready in %.2f s",
            time.perf_counter() - load_start,
        )
        return pipeline

    def _load_recon_model(self, config: Any):
        """Load (or return cached) LRM reconstruction model with InstantMesh weights."""
        if (
            InstantMeshPipeline._model is not None
            and InstantMeshPipeline._model_config_name == self.config_name
            and InstantMeshPipeline._device == self.device
        ):
            return InstantMeshPipeline._model

        import torch
        from huggingface_hub import hf_hub_download

        # `instantiate_from_config` lives in the vendored tree and uses
        # importlib to resolve `src.models.lrm_mesh.InstantMesh`. The
        # sys.path insert at module load makes that work.
        from src.utils.train_util import instantiate_from_config  # type: ignore[import-not-found]

        _LOG.info("loading reconstruction model %s …", self.config_name)
        load_start = time.perf_counter()
        model = instantiate_from_config(config.model_config)

        ckpt_filename = f"{self.config_name.replace('-', '_')}.ckpt"
        model_ckpt = hf_hub_download(
            repo_id=INSTANTMESH_REPO,
            filename=ckpt_filename,
            repo_type="model",
        )
        # Upstream's filter: keep only `lrm_generator.*` keys, strip the prefix.
        raw = torch.load(model_ckpt, map_location="cpu")["state_dict"]
        state_dict = {k[14:]: v for k, v in raw.items() if k.startswith("lrm_generator.")}
        model.load_state_dict(state_dict, strict=True)

        model = model.to(self.device)
        if self.config_name.startswith("instant-mesh"):
            model.init_flexicubes_geometry(torch.device(self.device), fovy=30.0)
        model.eval()

        InstantMeshPipeline._model = model
        InstantMeshPipeline._model_config_name = self.config_name
        InstantMeshPipeline._device = self.device
        _LOG.info(
            "reconstruction model ready in %.2f s",
            time.perf_counter() - load_start,
        )
        return model

    def generate(self, image: Image.Image) -> trimesh.Scene:
        import torch
        from einops import rearrange
        from omegaconf import OmegaConf
        from pytorch_lightning import seed_everything
        from torchvision.transforms import v2

        from src.utils.camera_util import get_zero123plus_input_cameras  # type: ignore[import-not-found]

        if image.mode != "RGBA":
            image = image.convert("RGBA")

        seed_everything(self.seed)
        config = OmegaConf.load(str(self._config_path()))

        # ---- Stage 1: Zero123++ multi-view ----
        # Move the diffusion pipeline to device only for this stage so that
        # peak VRAM = max(stage1, stage2) rather than the sum.
        diffusion = self._load_diffusion()
        diffusion = diffusion.to(self.device)
        try:
            stage1_start = time.perf_counter()
            mv_image = diffusion(
                image,
                num_inference_steps=self.diffusion_steps,
            ).images[0]
            _LOG.info(
                "Zero123++ multi-view %.2f s",
                time.perf_counter() - stage1_start,
            )
        finally:
            diffusion.to("cpu")
            if self.device.startswith("cuda"):
                torch.cuda.empty_cache()

        # Zero123++ output is a 960×640 grid of 6 views laid out as
        # 3 rows × 2 cols of 320×320 each. Rearrange via einops.
        mv_array = np.asarray(mv_image, dtype=np.float32) / 255.0
        mv_tensor = (
            torch.from_numpy(mv_array).permute(2, 0, 1).contiguous().float()
        )
        views = rearrange(mv_tensor, "c (n h) (m w) -> (n m) c h w", n=3, m=2)

        # ---- Stage 2: LRM reconstruction ----
        model = self._load_recon_model(config)
        input_cameras = get_zero123plus_input_cameras(
            batch_size=1, radius=4.0 * self.scale
        ).to(self.device)

        views_batch = views.unsqueeze(0).to(self.device)
        views_batch = v2.functional.resize(
            views_batch, 320, interpolation=3, antialias=True
        ).clamp(0, 1)

        stage2_start = time.perf_counter()
        with torch.no_grad():
            planes = model.forward_planes(views_batch, input_cameras)
            mesh_out = model.extract_mesh(
                planes,
                use_texture_map=False,  # vertex-color path; skips nvdiffrast
                **config.infer_config,
            )
        _LOG.info(
            "Reconstruction %.2f s",
            time.perf_counter() - stage2_start,
        )

        vertices, faces, vertex_colors = mesh_out
        if vertices is None or len(vertices) == 0:
            raise RuntimeError("InstantMesh produced no geometry")

        mesh = trimesh.Trimesh(
            vertices=np.asarray(vertices, dtype=np.float32),
            faces=np.asarray(faces, dtype=np.int64),
            vertex_colors=np.asarray(vertex_colors, dtype=np.uint8),
            process=False,
        )
        return trimesh.Scene(mesh)
