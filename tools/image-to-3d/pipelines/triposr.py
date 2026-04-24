"""TripoSR pipeline — the fast / low-VRAM path.

Upstream: https://github.com/VAST-AI-Research/TripoSR (MIT).

First call downloads the weights (~1.6 GB for `stabilityai/TripoSR`) into
the HuggingFace hub cache. Subsequent calls in the same process reuse the
cached model instance held as a class attribute; subsequent processes pay
a one-time from-disk load (~5 s on the target hardware) but no re-download.

VRAM profile on the target RTX 2000 Ada (8 GB):
  - weights           ~  0.6 GB
  - renderer chunk    ~  0.6 GB (chunk_size=8192)
  - marching cubes    ~  0.3 GB (resolution=256)
  - headroom          ~  6+ GB — plenty for concurrent browser tabs.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import ClassVar, Optional

import trimesh
from PIL import Image

from .base import Pipeline

_LOG = logging.getLogger(__name__)

# Vendored upstream TripoSR — cloned by `install_triposr.py`. Its `tsr/`
# package is added to sys.path here so `import tsr.system` resolves.
_TRIPOSR_DIR = Path(__file__).resolve().parent.parent / "external" / "TripoSR"
if _TRIPOSR_DIR.is_dir() and str(_TRIPOSR_DIR) not in sys.path:
    sys.path.insert(0, str(_TRIPOSR_DIR))


def _install_torchmcubes_shim() -> None:
    """TripoSR's `tsr.models.isosurface` does a hard `from torchmcubes import
    marching_cubes`. The upstream `torchmcubes` package is a CUDA+C++
    extension that needs MSVC Build Tools on Windows (documented hassle).
    We register a fake `torchmcubes` module that delegates to PyMCubes
    (pure Python, CPU) so TripoSR resolves the import without a native
    build. Runs at module load so it's in place before TripoSR is imported.
    """
    import types

    if "torchmcubes" in sys.modules:
        return

    import numpy as np
    import torch

    try:
        import mcubes as _mcubes  # PyMCubes
    except ImportError as exc:
        raise RuntimeError(
            "PyMCubes is required as a fallback for torchmcubes. "
            "Install it with `pip install PyMCubes`."
        ) from exc

    def marching_cubes(field: "torch.Tensor", iso: float):
        array = field.detach().cpu().numpy().astype(np.float32)
        verts, tris = _mcubes.marching_cubes(array, iso)
        return (
            torch.from_numpy(verts.astype(np.float32)),
            torch.from_numpy(tris.astype(np.int64)),
        )

    shim = types.ModuleType("torchmcubes")
    shim.marching_cubes = marching_cubes
    sys.modules["torchmcubes"] = shim


_install_torchmcubes_shim()

DEFAULT_MODEL_ID = "stabilityai/TripoSR"
DEFAULT_CONFIG_NAME = "config.yaml"
DEFAULT_WEIGHT_NAME = "model.ckpt"
DEFAULT_CHUNK_SIZE = 8192
DEFAULT_MC_RESOLUTION = 256
"""Marching cubes grid resolution — higher = more detail, more VRAM."""


class TripoSRPipeline(Pipeline):
    name: ClassVar[str] = "triposr"

    # Singleton cache so we don't reload the model on every invocation.
    _model: ClassVar[Optional[object]] = None
    _device: ClassVar[Optional[str]] = None

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        mc_resolution: int = DEFAULT_MC_RESOLUTION,
        device: Optional[str] = None,
    ) -> None:
        self.model_id = model_id
        self.chunk_size = chunk_size
        self.mc_resolution = mc_resolution
        self.device = device or self._pick_device()

    @staticmethod
    def _pick_device() -> str:
        import torch

        return "cuda:0" if torch.cuda.is_available() else "cpu"

    def _get_model(self):
        """Load (or return cached) TripoSR model."""
        if (
            TripoSRPipeline._model is not None
            and TripoSRPipeline._device == self.device
        ):
            return TripoSRPipeline._model

        _LOG.info("loading TripoSR weights from %s on %s …", self.model_id, self.device)
        load_start = time.perf_counter()
        # Deferred import — only pay tsr's cost when we actually generate.
        from tsr.system import TSR  # type: ignore[import-not-found]

        model = TSR.from_pretrained(
            self.model_id,
            config_name=DEFAULT_CONFIG_NAME,
            weight_name=DEFAULT_WEIGHT_NAME,
        )
        model.renderer.set_chunk_size(self.chunk_size)
        model.to(self.device)
        TripoSRPipeline._model = model
        TripoSRPipeline._device = self.device
        _LOG.info("TripoSR ready in %.2f s", time.perf_counter() - load_start)
        return model

    def generate(self, image: Image.Image) -> trimesh.Scene:
        if image.mode != "RGBA":
            image = image.convert("RGBA")

        # TripoSR's tokenizer expects RGB (3 channels). Upstream's run.py
        # composites the alpha-masked subject onto a neutral-gray background
        # to turn RGBA → RGB while preserving the alpha cutout as a soft
        # mask at composite time. We replicate that here.
        import numpy as np

        rgba = np.asarray(image, dtype=np.float32) / 255.0
        alpha = rgba[..., 3:4]
        rgb = rgba[..., :3] * alpha + 0.5 * (1.0 - alpha)
        rgb_image = Image.fromarray((rgb * 255.0).astype(np.uint8), mode="RGB")

        model = self._get_model()

        infer_start = time.perf_counter()
        scene_codes = model([rgb_image], device=self.device)
        meshes = model.extract_mesh(
            scene_codes,
            has_vertex_color=True,
            resolution=self.mc_resolution,
        )
        _LOG.info("TripoSR inference %.2f s", time.perf_counter() - infer_start)

        if not meshes:
            raise RuntimeError("TripoSR returned no mesh — input may be degenerate")
        primary = meshes[0]
        if not isinstance(primary, trimesh.Trimesh):
            primary = trimesh.Trimesh(
                vertices=primary.vertices,
                faces=primary.faces,
                vertex_colors=getattr(primary, "vertex_colors", None),
            )
        scene = trimesh.Scene(primary)
        return scene
