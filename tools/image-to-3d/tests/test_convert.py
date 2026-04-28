"""Tests for convert.py — focused on the batch-mode walker.

`convert_image` itself isn't unit-tested here — it's the integration point
of the whole stack and is exercised by the smoke tests / human review. The
batch wrapper is pure orchestration and benefits from cheap, deterministic
coverage.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

import convert


def _make_image(path: Path, size: tuple[int, int] = (512, 512)) -> None:
    # JPG can't carry an alpha channel; pick mode by extension.
    mode = "RGB" if path.suffix.lower() in (".jpg", ".jpeg") else "RGBA"
    fill = (100, 100, 100) if mode == "RGB" else (100, 100, 100, 255)
    Image.new(mode, size, fill).save(path)


@pytest.fixture
def mock_convert_image(monkeypatch: pytest.MonkeyPatch):
    """Replace convert_image with a recorder. Default behaviour is success;
    individual tests override via the `_responses` dict."""
    calls: list[Path] = []
    responses: dict[str, object] = {}

    def fake(*, input_path: Path, **_kwargs) -> int:
        calls.append(input_path)
        response = responses.get(input_path.name, 0)
        if isinstance(response, Exception):
            raise response
        return int(response)

    monkeypatch.setattr(convert, "convert_image", fake)
    return calls, responses


class TestConvertBatch:
    def test_returns_11_when_directory_does_not_exist(self, tmp_path: Path) -> None:
        rc = convert.convert_batch(
            directory=tmp_path / "nope",
            pipeline_name="triposr",
            output_dir=None,
            remove_background=False,
        )
        assert rc == 11

    def test_returns_11_when_directory_has_no_images(self, tmp_path: Path) -> None:
        (tmp_path / "notes.txt").write_text("hi")
        rc = convert.convert_batch(
            directory=tmp_path,
            pipeline_name="triposr",
            output_dir=None,
            remove_background=False,
        )
        assert rc == 11

    def test_processes_only_supported_image_extensions(
        self, tmp_path: Path, mock_convert_image
    ) -> None:
        calls, _ = mock_convert_image
        _make_image(tmp_path / "a.png")
        _make_image(tmp_path / "b.jpg")
        (tmp_path / "c.txt").write_text("ignore me")
        # Sub-directory shouldn't be recursed into.
        sub = tmp_path / "sub"
        sub.mkdir()
        _make_image(sub / "deep.png")

        rc = convert.convert_batch(
            directory=tmp_path,
            pipeline_name="triposr",
            output_dir=None,
            remove_background=False,
        )
        assert rc == 0
        names = sorted(p.name for p in calls)
        assert names == ["a.png", "b.jpg"]

    def test_returns_13_when_some_files_fail(
        self, tmp_path: Path, mock_convert_image
    ) -> None:
        calls, responses = mock_convert_image
        _make_image(tmp_path / "good.png")
        _make_image(tmp_path / "bad.png")
        responses["bad.png"] = 12

        rc = convert.convert_batch(
            directory=tmp_path,
            pipeline_name="triposr",
            output_dir=None,
            remove_background=False,
        )
        assert rc == 13
        assert sorted(p.name for p in calls) == ["bad.png", "good.png"]

    def test_continues_after_unexpected_exception(
        self, tmp_path: Path, mock_convert_image
    ) -> None:
        calls, responses = mock_convert_image
        _make_image(tmp_path / "first.png")
        _make_image(tmp_path / "blowup.png")
        _make_image(tmp_path / "third.png")
        responses["blowup.png"] = RuntimeError("model exploded")

        rc = convert.convert_batch(
            directory=tmp_path,
            pipeline_name="triposr",
            output_dir=None,
            remove_background=False,
        )
        assert rc == 13
        # All three should have been attempted, in alphabetical order.
        assert [p.name for p in calls] == ["blowup.png", "first.png", "third.png"]

    def test_returns_0_when_all_succeed(
        self, tmp_path: Path, mock_convert_image
    ) -> None:
        _make_image(tmp_path / "a.png")
        _make_image(tmp_path / "b.png")
        _make_image(tmp_path / "c.webp")

        rc = convert.convert_batch(
            directory=tmp_path,
            pipeline_name="instantmesh",
            output_dir=None,
            remove_background=False,
        )
        assert rc == 0
