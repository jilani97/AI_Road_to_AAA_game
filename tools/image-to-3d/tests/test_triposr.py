"""Smoke test for the TripoSR pipeline.

All tests here need GPU + the TripoSR weights downloaded, so they're marked
``slow``. Run explicitly with::

    pytest -m slow tests/test_triposr.py

Skipped (not failed) when CUDA is unavailable — keeps CPU-only CI hosts
from choking on a test that would take 10+ minutes on CPU.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import trimesh
from PIL import Image

cuda_unavailable = False
try:
    import torch

    cuda_unavailable = not torch.cuda.is_available()
except ImportError:
    cuda_unavailable = True

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(
        cuda_unavailable,
        reason="TripoSR smoke test requires CUDA",
    ),
]


def _fixture_image(tmp_path: Path) -> Path:
    """Solid-green 256×256 subject centred on transparent canvas — not a
    realistic test target (rembg won't help, TripoSR won't learn much), but
    enough to confirm the wiring end-to-end: load → infer → mesh → scene."""
    path = tmp_path / "fixture.png"
    image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    subject = Image.new("RGBA", (256, 256), (120, 200, 60, 255))
    image.paste(subject, (128, 128))
    image.save(path)
    return path


def test_triposr_pipeline_produces_nonempty_scene(tmp_path: Path) -> None:
    from pipelines.triposr import TripoSRPipeline
    from preprocessing import load_and_prepare

    pipeline = TripoSRPipeline()
    image = load_and_prepare(_fixture_image(tmp_path), remove_background=False)
    scene = pipeline.generate(image)

    assert isinstance(scene, trimesh.Scene)
    assert len(scene.geometry) >= 1

    total_faces = sum(
        getattr(mesh, "faces", []).shape[0]
        for mesh in scene.geometry.values()
        if isinstance(mesh, trimesh.Trimesh)
    )
    assert total_faces > 1_000


def test_model_is_cached_across_calls(tmp_path: Path) -> None:
    """Second .generate() in the same process must not reload weights."""
    from pipelines.triposr import TripoSRPipeline
    from preprocessing import load_and_prepare

    pipeline = TripoSRPipeline()
    image = load_and_prepare(_fixture_image(tmp_path), remove_background=False)

    # Warm-up call (may also download weights on first ever run).
    pipeline.generate(image)

    # Second call must complete in under 30 s — anything longer implies
    # a re-load or an OOM-triggered thrash.
    import time

    t0 = time.perf_counter()
    pipeline.generate(image)
    assert time.perf_counter() - t0 < 30.0
