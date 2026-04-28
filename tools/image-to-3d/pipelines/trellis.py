"""TRELLIS pipeline — quality path (Phase 4).

TRELLIS produces a UV-mapped textured GLB from a single image via its
structured-latent diffusion (sparse-structure → SLAT) plus a Gaussian-splat
→ mesh export with multi-view texture-bake. See `microsoft/TRELLIS` for the
upstream model.

Runtime model: TRELLIS only runs on WSL on this Windows rig. Four CUDA
extensions (nvdiffrast, diffoctreerast, diff-gaussian-rasterization,
vox2seq) don't ship Windows wheels for our torch 2.5.1+cu121 stack — see
the wheel-walls write-up in cffb462. The pipeline subprocess-shells to a
runner inside WSL (`wsl/trellis_runner.py`) and loads the result GLB back
into the host process via trimesh, so the rest of the tool (preprocessing,
sidecar metadata, Gradio UI, Babylon dev server) stays Windows-native.

Optional post-step: synthesize a tangent-space normal map from the
baseColor texture using Marigold-Normals (`prs-eth/marigold-normals-v0-1`,
~3.5 GB, ~8 s per bake on RTX 2000 Ada, fp16). Marigold runs in *this*
host process — it's pure PyTorch and doesn't need TRELLIS's CUDA
extensions, so no extra WSL hop. Closes most of the "feels like polygons"
gap on TRELLIS's baseColor-only output. Per-island synthesis on the UV
atlas; UV-island seam artefacts have not been observable so far.

Defaults are upstream's max-quality preset with the texture-size keeper
from our HQ run review (simplify=0.95 was the right floor — going to 0.9
exposed marching-cubes noise; texture_size=2048 is the keeper).
"""

from __future__ import annotations

import logging
import re
import shlex
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, ClassVar, Optional

import numpy as np
import trimesh
from PIL import Image

from .base import Pipeline

ProgressCallback = Callable[[float, str], None]

_LOG = logging.getLogger(__name__)

DEFAULT_SIMPLIFY = 0.95
DEFAULT_TEXTURE_SIZE = 2048
DEFAULT_SS_STEPS = 12
DEFAULT_SLAT_STEPS = 12
DEFAULT_SEED = 42
NORMAL_MODEL_ID = "prs-eth/marigold-normals-v0-1"

# Lines like "EVENT inference_done elapsed=48.10" emitted by the WSL runner.
_EVENT_RE = re.compile(r"^EVENT (\w+)(?:\s+(.*))?$")


def _windows_to_wsl_path(p: Path) -> str:
    """C:\\Users\\... -> /mnt/c/Users/... (lowercase drive, forward slashes)."""
    abs_str = str(Path(p).resolve())
    drive = abs_str[0].lower()
    rest = abs_str[2:].replace("\\", "/")
    return f"/mnt/{drive}{rest}"


class TrellisPipeline(Pipeline):
    """TRELLIS-image-large via WSL subprocess + optional Marigold normal-bake."""

    name: ClassVar[str] = "trellis"

    # Marigold loaded once per process; shared across calls. The TRELLIS
    # pipeline itself lives inside the WSL subprocess and is reloaded on
    # every call — fixing that requires a long-running WSL daemon, which is
    # deferred (see future-specs/image-to-3d-trellis-daemon.md if added).
    _normal_pipe: ClassVar[Optional[Any]] = None

    def __init__(
        self,
        simplify: float = DEFAULT_SIMPLIFY,
        texture_size: int = DEFAULT_TEXTURE_SIZE,
        ss_steps: int = DEFAULT_SS_STEPS,
        slat_steps: int = DEFAULT_SLAT_STEPS,
        seed: int = DEFAULT_SEED,
        bake_normals: bool = True,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> None:
        self.simplify = simplify
        self.texture_size = texture_size
        self.ss_steps = ss_steps
        self.slat_steps = slat_steps
        self.seed = seed
        self.bake_normals = bake_normals
        self.progress_callback = progress_callback

    def _report(self, fraction: float, message: str) -> None:
        if self.progress_callback is None:
            return
        try:
            self.progress_callback(fraction, message)
        except Exception:  # noqa: BLE001 — UI hiccups must not break inference
            _LOG.exception("progress callback raised; ignoring")

    def generate(self, image: Image.Image) -> trimesh.Scene:
        # TRELLIS expects a single-view RGB on a white background — its UNet
        # is conditioned on white-bg multi-view renders. RGBA composited
        # directly produces black-edged silhouettes, so flatten onto white.
        if image.mode == "RGBA":
            white_bg = Image.new("RGB", image.size, (255, 255, 255))
            white_bg.paste(image, mask=image.split()[3])
            image_for_trellis = white_bg
        else:
            image_for_trellis = image.convert("RGB")

        with tempfile.TemporaryDirectory(prefix="trellis_") as tmpdir:
            tmp_dir = Path(tmpdir)
            in_path = tmp_dir / "input.png"
            out_path = tmp_dir / "output.glb"
            image_for_trellis.save(in_path)

            self._report(0.0, "Spawning TRELLIS runner (WSL)")
            self._run_wsl(in_path, out_path)

            self._report(0.85, "Loading GLB into trimesh")
            scene = trimesh.load(str(out_path), process=False)

        if self.bake_normals:
            self._report(0.90, "Baking normal map (Marigold)")
            scene = self._bake_normals(scene)

        self._report(1.0, "Mesh complete")
        return scene

    def _run_wsl(self, in_path: Path, out_path: Path) -> None:
        runner_path = Path(__file__).resolve().parent.parent / "wsl" / "trellis_runner.py"
        wsl_cmd = " ".join(
            [
                "~/trellis-venv/bin/python",
                shlex.quote(_windows_to_wsl_path(runner_path)),
                "--in", shlex.quote(_windows_to_wsl_path(in_path)),
                "--out", shlex.quote(_windows_to_wsl_path(out_path)),
                "--simplify", str(self.simplify),
                "--texture-size", str(self.texture_size),
                "--ss-steps", str(self.ss_steps),
                "--slat-steps", str(self.slat_steps),
                "--seed", str(self.seed),
            ]
        )
        cmd = ["wsl", "bash", "-c", wsl_cmd]
        _LOG.info("spawn (wsl): %s", wsl_cmd)
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            # Force UTF-8 with replacement: WSL emits UTF-8 (tqdm uses block
            # chars like ▏▎▍ for progress bars), but Python on Windows
            # defaults the subprocess decoder to cp1252, which crashes on
            # those bytes. Replace-on-error keeps the stream alive without
            # affecting the EVENT-line parsing (those are pure ASCII).
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip()
            if not line:
                continue
            event = _EVENT_RE.match(line)
            if event:
                # Texture bake (the long pole) happens between inference_done
                # and export_done, so we sit at 0.40 with a "baking texture"
                # message while it grinds.
                name = event.group(1)
                if name == "pipeline_loaded":
                    self._report(0.10, "TRELLIS pipeline loaded")
                elif name == "inference_done":
                    self._report(0.40, "Baking texture (long step)")
                elif name == "export_done":
                    self._report(0.85, "GLB exported by runner")
            else:
                _LOG.info("[wsl] %s", line)
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"TRELLIS WSL runner exited with code {rc}")
        if not out_path.is_file():
            raise RuntimeError(f"TRELLIS WSL runner finished but did not produce {out_path}")

    def _bake_normals(self, scene: trimesh.Scene) -> trimesh.Scene:
        import torch
        from diffusers import MarigoldNormalsPipeline

        geom = next(iter(scene.geometry.values()))
        material = geom.visual.material
        base_color = getattr(material, "baseColorTexture", None)
        if base_color is None:
            _LOG.warning("normal-bake: no baseColorTexture on material; skipping")
            return scene

        if TrellisPipeline._normal_pipe is None:
            _LOG.info("loading Marigold-Normals (%s) ...", NORMAL_MODEL_ID)
            t0 = time.perf_counter()
            TrellisPipeline._normal_pipe = MarigoldNormalsPipeline.from_pretrained(
                NORMAL_MODEL_ID, torch_dtype=torch.float16
            ).to("cuda")
            _LOG.info("Marigold ready in %.2f s", time.perf_counter() - t0)

        t1 = time.perf_counter()
        result = TrellisPipeline._normal_pipe(base_color.convert("RGB"))
        _LOG.info("Marigold inference %.2f s", time.perf_counter() - t1)

        pred = result.prediction
        if isinstance(pred, (list, tuple)):
            pred = pred[0]
        if isinstance(pred, torch.Tensor):
            pred = pred.detach().cpu().numpy()
        if pred.ndim == 4:
            pred = pred[0]
        if pred.ndim == 3 and pred.shape[0] == 3:
            pred = pred.transpose(1, 2, 0)

        normal_rgb = ((pred + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
        normal_pil = Image.fromarray(normal_rgb, mode="RGB")
        if normal_pil.size != base_color.size:
            normal_pil = normal_pil.resize(base_color.size, Image.LANCZOS)
        material.normalTexture = normal_pil
        return scene
