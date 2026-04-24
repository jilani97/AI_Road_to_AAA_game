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


def load_and_prepare(
    path: Path | str,
    target_size: int = 512,
    remove_background: bool = True,
) -> Image.Image:
    """Load a 2-D image and return a pipeline-ready RGBA square.

    Steps (all lossless except the final resize):
      1. Load the source, convert to RGBA.
      2. (optional) Run rembg to isolate the subject on transparent bg.
      3. Crop tight around non-transparent pixels.
      4. Pad with transparency so the canvas is square.
      5. Resize to ``target_size × target_size`` using Lanczos resampling.

    Arguments:
      path: path to a JPG, JPEG, PNG, or WEBP file.
      target_size: side length of the output square. Pipelines pick 256 or 512.
      remove_background: when False, skip rembg and trust the input's alpha.
        Useful when the input is already a transparent PNG.

    Returns:
      A ``PIL.Image.Image`` in ``RGBA`` mode at ``target_size × target_size``.

    Raises:
      FileNotFoundError: path does not exist.
      ValueError: unsupported extension.
    """
    path = Path(path)
    if path.suffix.lower() not in SUPPORTED_FORMATS:
        raise ValueError(
            f"unsupported image format: {path.suffix!r} "
            f"(supported: {sorted(SUPPORTED_FORMATS)})"
        )
    if not path.exists():
        raise FileNotFoundError(path)

    image = Image.open(path).convert("RGBA")

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
