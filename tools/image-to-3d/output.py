"""Output routing for generated GLBs.

The canonical drop zone is the game's ``public/models/generated/`` — Vite
serves that as ``/models/generated/*`` and Babylon's ``ImportMeshAsync``
picks it up without any extra config. Each generated file also gets a
``.meta.json`` sidecar recording source image, pipeline, timestamp, and
basic mesh stats for reproducibility.

    from output import default_output_dir, resolve_output_path, \
        export_scene_to_glb, write_sidecar_meta

    target = resolve_output_path("dragon")  # default out_dir
    export_scene_to_glb(scene, target)
    write_sidecar_meta(target, source_image=src, pipeline="triposr", scene=scene)
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import trimesh


def default_output_dir() -> Path:
    """``<repo>/public/models/generated/``.

    Resolved from this file's location — ``tools/image-to-3d/output.py``
    → ``public/models/generated/``. The directory is not created here;
    ``resolve_output_path`` ensures it exists at write time.
    """
    return (
        Path(__file__).resolve().parent.parent.parent
        / "public"
        / "models"
        / "generated"
    )


def _timestamp(now: Optional[datetime] = None) -> str:
    """Millisecond-precision timestamp — collision-safe at any realistic rate."""
    now = now or datetime.now()
    return now.strftime("%Y%m%d-%H%M%S-") + f"{now.microsecond // 1000:03d}"


def resolve_output_path(
    base_filename: str,
    out_dir: Optional[Path] = None,
    *,
    pipeline: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Path:
    """Return a timestamped GLB path. Creates the directory if missing.

    ``base_filename`` may include an extension; it is stripped. When
    ``pipeline`` is given, the result is ``<stem>-<pipeline>-<ts>.glb``;
    otherwise ``<stem>-<ts>.glb``. Including the pipeline lets the Babylon
    dev loader auto-detect glTF up-axis (TRELLIS exports Y-up, others Z-up)
    from the filename without reading the file.
    """
    directory = Path(out_dir) if out_dir is not None else default_output_dir()
    directory.mkdir(parents=True, exist_ok=True)
    stem = Path(base_filename).stem or "generated"
    suffix = f"-{pipeline}" if pipeline else ""
    return directory / f"{stem}{suffix}-{_timestamp(now)}.glb"


def export_scene_to_glb(scene: trimesh.Scene, path: Path) -> None:
    """Write ``scene`` to ``path`` as a binary GLB."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.export(path, file_type="glb")


def write_sidecar_meta(
    glb_path: Path,
    *,
    source_image: Path,
    pipeline: str,
    scene: trimesh.Scene,
    extra: Optional[dict[str, Any]] = None,
) -> Path:
    """Write ``<glb_path>.meta.json`` with provenance and mesh stats."""
    glb_path = Path(glb_path)
    meta_path = glb_path.with_suffix(".meta.json")

    triangles = 0
    vertices = 0
    for geom in scene.geometry.values():
        if isinstance(geom, trimesh.Trimesh):
            triangles += int(geom.faces.shape[0])
            vertices += int(geom.vertices.shape[0])

    data: dict[str, Any] = {
        "source_image": str(source_image),
        "pipeline": pipeline,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "mesh_stats": {"triangles": triangles, "vertices": vertices},
    }
    if extra:
        data.update(extra)

    meta_path.write_text(json.dumps(data, indent=2))
    return meta_path
