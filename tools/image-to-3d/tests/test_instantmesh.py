"""Smoke test for the InstantMesh pipeline.

GPU + ~6.5 GB of HF weights required, so all tests here are marked ``slow``.
Run explicitly with::

    pytest -m slow tests/test_instantmesh.py

Skipped (not failed) when CUDA is unavailable.
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
        reason="InstantMesh smoke test requires CUDA",
    ),
]


def _fixture_image(tmp_path: Path) -> Path:
    """A solid-coloured square subject on transparent canvas — enough to
    confirm wiring (load → diffuse → fuse → mesh → scene) without
    pretending to test mesh quality."""
    path = tmp_path / "fixture.png"
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    subject = Image.new("RGBA", (256, 256), (160, 80, 200, 255))
    canvas.paste(subject, (128, 128))
    canvas.save(path)
    return path


def test_instantmesh_pipeline_produces_vertex_colored_scene(tmp_path: Path) -> None:
    from pipelines.instantmesh import InstantMeshPipeline
    from preprocessing import load_and_prepare

    pipeline = InstantMeshPipeline(diffusion_steps=30)  # speed up the smoke
    image = load_and_prepare(_fixture_image(tmp_path), remove_background=False)
    scene = pipeline.generate(image)

    assert isinstance(scene, trimesh.Scene)
    assert len(scene.geometry) >= 1

    primary = next(iter(scene.geometry.values()))
    assert isinstance(primary, trimesh.Trimesh)
    assert primary.vertices.shape[0] > 1_000
    assert primary.faces.shape[0] > 1_000

    # Vertex colors are the whole point of the vertex-color output path.
    assert hasattr(primary.visual, "vertex_colors")
    assert primary.visual.vertex_colors is not None
    assert primary.visual.vertex_colors.shape[0] == primary.vertices.shape[0]


def test_models_are_cached_across_calls(tmp_path: Path) -> None:
    """Second .generate() in the same process must reuse loaded weights."""
    import time

    from pipelines.instantmesh import InstantMeshPipeline
    from preprocessing import load_and_prepare

    pipeline = InstantMeshPipeline(diffusion_steps=30)
    image = load_and_prepare(_fixture_image(tmp_path), remove_background=False)

    # Warm-up — may also download ~6.5 GB on first ever run.
    pipeline.generate(image)

    # Second call: no weight download, no model re-instantiation. Generous
    # 90 s budget covers diffusion + reconstruction at fp16 on the target
    # RTX 2000 Ada.
    t0 = time.perf_counter()
    pipeline.generate(image)
    assert time.perf_counter() - t0 < 90.0


def test_peak_vram_under_8gb(tmp_path: Path) -> None:
    """Peak VRAM during a generate() must fit in the target hardware's 8 GB."""
    import torch

    from pipelines.instantmesh import InstantMeshPipeline
    from preprocessing import load_and_prepare

    pipeline = InstantMeshPipeline(diffusion_steps=30)
    image = load_and_prepare(_fixture_image(tmp_path), remove_background=False)

    torch.cuda.reset_peak_memory_stats()
    pipeline.generate(image)
    peak_bytes = torch.cuda.max_memory_allocated()
    peak_gb = peak_bytes / (1024 ** 3)
    assert peak_gb < 8.0, f"peak VRAM {peak_gb:.2f} GB exceeds 8 GB budget"
