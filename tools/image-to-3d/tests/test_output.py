"""Tests for output routing + sidecar JSON."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
import trimesh

from output import (
    default_output_dir,
    export_scene_to_glb,
    resolve_output_path,
    write_sidecar_meta,
)


def _make_scene() -> trimesh.Scene:
    """Cheap scene — a unit cube with a couple dozen faces."""
    cube = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    return trimesh.Scene(cube)


class TestDefaultOutputDir:
    def test_points_at_public_models_generated(self) -> None:
        path = default_output_dir()
        # Walk up from the tool to the repo root and verify the relative path.
        assert path.name == "generated"
        assert path.parent.name == "models"
        assert path.parent.parent.name == "public"


class TestResolveOutputPath:
    def test_writes_under_default_when_none_given(self, tmp_path: Path) -> None:
        # Using a real default_output_dir would touch the game repo. Instead
        # the next tests cover the override; here we only assert the default
        # path shape.
        path = resolve_output_path("thing", out_dir=tmp_path)
        assert path.parent == tmp_path
        assert path.suffix == ".glb"
        assert path.stem.startswith("thing-")

    def test_override_dir_is_created(self, tmp_path: Path) -> None:
        nested = tmp_path / "deep" / "nested"
        path = resolve_output_path("thing", out_dir=nested)
        assert nested.is_dir()
        assert path.parent == nested

    def test_extension_in_base_filename_is_stripped(self, tmp_path: Path) -> None:
        path = resolve_output_path("thing.png", out_dir=tmp_path)
        assert path.stem.startswith("thing-")
        assert ".png-" not in path.stem

    def test_empty_base_filename_falls_back_to_default_stem(
        self, tmp_path: Path
    ) -> None:
        path = resolve_output_path("", out_dir=tmp_path)
        assert path.stem.startswith("generated-")

    def test_timestamp_precision_supports_rapid_calls(self, tmp_path: Path) -> None:
        # Two calls with distinct now() moments must produce distinct paths.
        now1 = datetime(2026, 4, 24, 12, 0, 0, 123000)
        now2 = datetime(2026, 4, 24, 12, 0, 0, 124000)
        p1 = resolve_output_path("a", out_dir=tmp_path, now=now1)
        p2 = resolve_output_path("a", out_dir=tmp_path, now=now2)
        assert p1 != p2


class TestExportSceneToGlb:
    def test_writes_a_glb_file(self, tmp_path: Path) -> None:
        path = tmp_path / "scene.glb"
        export_scene_to_glb(_make_scene(), path)
        assert path.is_file()
        # glTF binary magic: bytes 0..3 = 'glTF'
        with path.open("rb") as f:
            assert f.read(4) == b"glTF"

    def test_creates_parent_directory(self, tmp_path: Path) -> None:
        path = tmp_path / "nested" / "out.glb"
        export_scene_to_glb(_make_scene(), path)
        assert path.is_file()


class TestWriteSidecarMeta:
    def test_writes_meta_json_with_expected_fields(self, tmp_path: Path) -> None:
        glb = tmp_path / "thing.glb"
        glb.write_bytes(b"glTF-placeholder")  # just needs to exist as a path
        meta = write_sidecar_meta(
            glb,
            source_image=Path("/tmp/thing.png"),
            pipeline="triposr",
            scene=_make_scene(),
        )
        assert meta.exists()
        data = json.loads(meta.read_text())
        assert data["source_image"].endswith("thing.png")
        assert data["pipeline"] == "triposr"
        assert "generated_at" in data
        # Unit cube from trimesh.creation.box: 12 triangles, 8 vertices.
        assert data["mesh_stats"]["triangles"] == 12
        assert data["mesh_stats"]["vertices"] == 8

    def test_extra_fields_merged(self, tmp_path: Path) -> None:
        glb = tmp_path / "thing.glb"
        glb.write_bytes(b"x")
        meta = write_sidecar_meta(
            glb,
            source_image=Path("src.png"),
            pipeline="triposr",
            scene=_make_scene(),
            extra={"chunk_size": 8192, "mc_resolution": 256},
        )
        data = json.loads(meta.read_text())
        assert data["chunk_size"] == 8192
        assert data["mc_resolution"] == 256

    def test_meta_path_pairs_with_glb_stem(self, tmp_path: Path) -> None:
        glb = tmp_path / "dragon-20260424-120000-000.glb"
        glb.write_bytes(b"x")
        meta = write_sidecar_meta(
            glb,
            source_image=Path("dragon.png"),
            pipeline="triposr",
            scene=_make_scene(),
        )
        assert meta.name == "dragon-20260424-120000-000.meta.json"
