"""Tests for preprocessing.py.

Fixtures are synthesised on the fly via PIL so the repo doesn't carry binary
artefacts. rembg-backed tests are marked ``slow`` — they download an ONNX
model on first run. Run fast tests only with::

    pytest -m "not slow"
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from preprocessing import (
    MAX_FILE_SIZE_MB,
    MAX_IMAGE_DIMENSION,
    MIN_IMAGE_DIMENSION,
    SUPPORTED_FORMATS,
    InputValidationError,
    _crop_to_subject,
    _pad_to_square,
    load_and_prepare,
    validate_input_image,
    validate_input_path,
)


def _draw_subject_rgba(size: tuple[int, int]) -> Image.Image:
    """Transparent canvas with an opaque square centred at 1/2 of each side
    spanning 1/2 of the canvas. Useful for deterministic bbox / pad tests."""
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    w, h = size
    sw, sh = w // 2, h // 2
    x0, y0 = (w - sw) // 2, (h - sh) // 2
    subject = Image.new("RGBA", (sw, sh), (120, 200, 60, 255))
    image.paste(subject, (x0, y0))
    return image


def _draw_filled_rgb(size: tuple[int, int]) -> Image.Image:
    """Fully opaque rectangle — mimics a JPG photograph."""
    return Image.new("RGB", size, (200, 50, 80))


@pytest.fixture
def transparent_png(tmp_path: Path) -> Path:
    # Landscape; chosen so the short edge stays >= MIN_IMAGE_DIMENSION (256)
    # so this fixture passes pre-pipeline validation.
    path = tmp_path / "transparent.png"
    _draw_subject_rgba((512, 256)).save(path)
    return path


@pytest.fixture
def square_transparent_png(tmp_path: Path) -> Path:
    path = tmp_path / "square.png"
    _draw_subject_rgba((300, 300)).save(path)
    return path


@pytest.fixture
def opaque_jpg(tmp_path: Path) -> Path:
    path = tmp_path / "opaque.jpg"
    _draw_filled_rgb((640, 480)).save(path, format="JPEG", quality=90)
    return path


class TestCropToSubject:
    def test_crops_to_subject_bbox(self) -> None:
        image = _draw_subject_rgba((400, 200))
        cropped = _crop_to_subject(image)
        assert cropped.size == (200, 100)

    def test_fully_transparent_is_unchanged(self) -> None:
        image = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        result = _crop_to_subject(image)
        assert result.size == image.size

    def test_fully_opaque_is_unchanged(self) -> None:
        image = Image.new("RGBA", (256, 256), (10, 20, 30, 255))
        result = _crop_to_subject(image)
        assert result.size == image.size


class TestPadToSquare:
    @pytest.mark.parametrize(
        ("w", "h"),
        [(200, 100), (100, 200), (300, 150), (150, 300)],
    )
    def test_pads_to_square_with_transparent_border(self, w: int, h: int) -> None:
        image = _draw_subject_rgba((w, h))
        padded = _pad_to_square(image)
        assert padded.size == (max(w, h), max(w, h))
        # Corners should remain transparent after padding.
        assert padded.getpixel((0, 0)) == (0, 0, 0, 0)

    def test_square_input_is_unchanged(self) -> None:
        image = _draw_subject_rgba((256, 256))
        padded = _pad_to_square(image)
        assert padded.size == (256, 256)


class TestLoadAndPrepare:
    def test_returns_rgba_at_target_size_from_landscape(
        self, transparent_png: Path
    ) -> None:
        result = load_and_prepare(
            transparent_png, target_size=512, remove_background=False
        )
        assert result.mode == "RGBA"
        assert result.size == (512, 512)

    @pytest.mark.parametrize("target", [256, 512, 1024])
    def test_any_target_size(self, transparent_png: Path, target: int) -> None:
        result = load_and_prepare(
            transparent_png, target_size=target, remove_background=False
        )
        assert result.size == (target, target)

    def test_preserves_alpha_when_bg_removal_skipped(
        self, transparent_png: Path
    ) -> None:
        # Landscape (400×200) → crop_to_subject gives (200×100) →
        # pad_to_square adds transparent padding top + bottom → resize 512.
        # Centre row (y=256) is subject; y=0 is in the padding band.
        result = load_and_prepare(
            transparent_png, target_size=512, remove_background=False
        )
        assert result.getpixel((256, 256))[3] == 255
        assert result.getpixel((256, 0))[3] == 0

    def test_rejects_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            load_and_prepare(tmp_path / "nope.png", remove_background=False)

    def test_rejects_unsupported_format(self, tmp_path: Path) -> None:
        path = tmp_path / "payload.txt"
        path.write_text("not an image")
        with pytest.raises(ValueError, match="unsupported image format"):
            load_and_prepare(path)

    def test_supported_format_set_covers_the_common_ones(self) -> None:
        # Sanity check on the public contract.
        assert {".jpg", ".jpeg", ".png", ".webp"} <= SUPPORTED_FORMATS

    @pytest.mark.slow
    def test_runs_rembg_end_to_end(self, opaque_jpg: Path) -> None:
        # Expensive: rembg downloads ONNX weights (~175 MB) on first call.
        result = load_and_prepare(opaque_jpg, target_size=256)
        assert result.mode == "RGBA"
        assert result.size == (256, 256)


class TestValidators:
    def test_path_validation_accepts_a_normal_input(
        self, transparent_png: Path
    ) -> None:
        resolved = validate_input_path(transparent_png)
        assert resolved == transparent_png.resolve()

    def test_path_validation_rejects_oversized_file(self, tmp_path: Path) -> None:
        path = tmp_path / "huge.png"
        path.write_bytes(b"\x00" * (MAX_FILE_SIZE_MB * 1024 * 1024 + 1))
        with pytest.raises(InputValidationError, match=r"larger than the \d+ MB"):
            validate_input_path(path)

    def test_image_validation_rejects_below_min_dimension(self) -> None:
        below = MIN_IMAGE_DIMENSION - 1
        image = Image.new("RGB", (below, MIN_IMAGE_DIMENSION + 100))
        with pytest.raises(InputValidationError, match="below the .* minimum"):
            validate_input_image(image)

    def test_image_validation_rejects_above_max_dimension(self) -> None:
        above = MAX_IMAGE_DIMENSION + 1
        image = Image.new("RGB", (above, MAX_IMAGE_DIMENSION))
        with pytest.raises(InputValidationError, match="exceeds the .* maximum"):
            validate_input_image(image)

    def test_image_validation_accepts_at_min_dimension(self) -> None:
        image = Image.new("RGB", (MIN_IMAGE_DIMENSION, MIN_IMAGE_DIMENSION))
        validate_input_image(image)  # no raise

    def test_image_validation_accepts_at_max_dimension(self) -> None:
        image = Image.new("RGB", (MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION))
        validate_input_image(image)  # no raise

    def test_load_and_prepare_rejects_undersized_image(self, tmp_path: Path) -> None:
        path = tmp_path / "tiny.png"
        Image.new("RGBA", (128, 128)).save(path)
        with pytest.raises(InputValidationError, match="below the .* minimum"):
            load_and_prepare(path, remove_background=False)

    def test_input_validation_error_subclasses_value_error(self) -> None:
        # Existing callers that catch ValueError must keep working.
        assert issubclass(InputValidationError, ValueError)
