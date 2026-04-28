"""Image preprocessing for the image-to-3D pipelines.

Both TripoSR and Trellis want an RGBA image with the subject isolated on a
transparent background, cropped tight, and resized to a fixed square target
(256 / 512 / 1024 depending on the pipeline and VRAM budget).

Default path:
    load_and_prepare(path)  -> bg-removed, tight-cropped, padded-to-square, RGBA

Escape hatch for images that are already pristine transparent PNGs:
    load_and_prepare(path, remove_background=False)
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Final

from PIL import Image

SUPPORTED_FORMATS: Final[frozenset[str]] = frozenset(
    {".jpg", ".jpeg", ".png", ".webp"}
)
"""Image extensions accepted by `load_and_prepare`."""

MAX_FILE_SIZE_MB: Final[int] = 50
"""Reject inputs larger than this on disk. High-res concept art tops out at
~20 MB in practice; anything over 50 MB usually means the user dropped a
lossless DSLR frame in by accident."""

MIN_IMAGE_DIMENSION: Final[int] = 256
"""Inputs smaller than this on the long edge don't carry enough signal for
any of the pipelines to produce a usable mesh — fail early instead of
running a 30-min Trellis bake on noise."""

MAX_IMAGE_DIMENSION: Final[int] = 4096
"""Cap to keep PIL out of `Image.DecompressionBombError` territory and
ensure preprocessing's resize step starts from a sane base."""


class InputValidationError(ValueError):
    """Raised when an input image fails pre-pipeline validation. Subclasses
    ValueError so existing ``except ValueError`` callers still catch it."""


def validate_input_path(path: Path | str) -> Path:
    """Filesystem-side checks: path exists, extension is supported, file is
    not absurdly large. Returns the resolved Path on success.

    Called by the CLI before any heavy import. UI inputs go through
    `validate_input_image` instead — Gradio hands us a PIL image, not a
    path.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    if path.suffix.lower() not in SUPPORTED_FORMATS:
        raise InputValidationError(
            f"unsupported image format: {path.suffix!r} "
            f"(supported: {sorted(SUPPORTED_FORMATS)})"
        )
    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise InputValidationError(
            f"input file is {size_mb:.1f} MB, larger than the {MAX_FILE_SIZE_MB} MB "
            f"limit. Re-export at a saner resolution; the pipelines downsample "
            f"to 512² or 1024² regardless."
        )
    return path


def validate_input_image(image: Image.Image) -> None:
    """In-memory checks: dimensions are within bounds, image decodes cleanly.
    Raises ``InputValidationError`` on failure with a message suitable for
    surfacing to the user (CLI stderr or Gradio toast)."""
    width, height = image.size
    long_edge = max(width, height)
    short_edge = min(width, height)
    if short_edge < MIN_IMAGE_DIMENSION:
        raise InputValidationError(
            f"input image is {width}×{height}; short edge ({short_edge}) is "
            f"below the {MIN_IMAGE_DIMENSION}-pixel minimum. The pipelines "
            f"need at least that much signal to produce a usable mesh."
        )
    if long_edge > MAX_IMAGE_DIMENSION:
        raise InputValidationError(
            f"input image is {width}×{height}; long edge ({long_edge}) "
            f"exceeds the {MAX_IMAGE_DIMENSION}-pixel maximum. Downscale "
            f"before feeding it in — preprocessing resizes to 512² anyway."
        )


def load_and_prepare(
    path: Path | str,
    target_size: int = 512,
    remove_background: bool = True,
) -> Image.Image:
    """Load a 2-D image from disk and return a pipeline-ready RGBA square.

    Thin wrapper around ``preprocess_image`` that adds file I/O + format
    + dimension validation. Used by the CLI; the UI calls
    ``preprocess_image`` directly on Gradio's uploaded PIL image after
    calling ``validate_input_image`` itself.

    Raises:
      FileNotFoundError: path does not exist.
      InputValidationError: unsupported extension, oversized file, or
        out-of-range dimensions.
    """
    path = validate_input_path(path)
    image = Image.open(path)
    validate_input_image(image)
    return preprocess_image(image, target_size, remove_background)


def preprocess_image(
    image: Image.Image,
    target_size: int = 512,
    remove_background: bool = True,
) -> Image.Image:
    """Return a pipeline-ready RGBA square from an already-loaded PIL image.

    Steps (all lossless except the final resize):
      1. Convert to RGBA.
      2. (optional) Run rembg to isolate the subject on transparent bg.
      3. Crop tight around non-transparent pixels.
      4. Pad with transparency so the canvas is square.
      5. Resize to ``target_size × target_size`` using Lanczos resampling.
    """
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    if remove_background:
        image = _remove_background(image)

    image = _crop_to_subject(image)
    image = _pad_to_square(image)
    if image.size != (target_size, target_size):
        image = image.resize((target_size, target_size), Image.Resampling.LANCZOS)
    return image


def _remove_background(image: Image.Image) -> Image.Image:
    """Run rembg on the image. Returns a fresh RGBA ``PIL.Image.Image``.

    rembg exposes multiple invocation styles; to stay robust across releases
    we serialise to PNG bytes, run, and deserialise — the bytes path is the
    one contract that's stable.
    """
    # Lazy import: rembg also lazy-downloads ONNX weights on first use, so we
    # only pay the cost when the caller actually wants bg removal.
    from rembg import remove  # type: ignore[import-untyped]

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    output_bytes = remove(buf.getvalue())
    return Image.open(io.BytesIO(output_bytes)).convert("RGBA")


def _crop_to_subject(image: Image.Image) -> Image.Image:
    """Tight-crop around non-transparent pixels. No-op on fully opaque or
    fully transparent inputs."""
    if image.mode != "RGBA":
        return image
    alpha = image.split()[3]
    bbox = alpha.getbbox()
    if bbox is None:
        # Fully transparent — nothing to crop. Return the original.
        return image
    if bbox == (0, 0, image.width, image.height):
        # Subject fills the canvas; cropping would be a no-op.
        return image
    return image.crop(bbox)


def _pad_to_square(image: Image.Image) -> Image.Image:
    """Pad the image (with transparency) so width == height, subject centred."""
    width, height = image.size
    if width == height:
        return image
    side = max(width, height)
    padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset = ((side - width) // 2, (side - height) // 2)
    padded.paste(image, offset)
    return padded
