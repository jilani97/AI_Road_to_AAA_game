"""Image-to-3D converter CLI.

Usage:
    python convert.py image.png                          # triposr, default out dir
    python convert.py image.png --pipeline triposr       # explicit
    python convert.py image.png --pipeline trellis       # Phase 4 (not yet wired)
    python convert.py image.png --output-dir /tmp/out    # override target
    python convert.py image.png --no-bg-removal          # trust input alpha
    python convert.py --probe                            # report torch / CUDA / GPU
    python convert.py --probe-trellis                    # check Trellis deps (Phase 4)

Exit codes:
    0   success
    1   hard failure (torch missing, pipeline OOM, ...)
    2   CUDA unavailable during --probe (warning-level)
    10  pipeline requested but not yet implemented
    64  usage error (missing input when no --probe flag)
    66  input file does not exist
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Optional

_LOG = logging.getLogger("image-to-3d")

PIPELINE_CHOICES = ("triposr", "trellis")


def probe() -> int:
    """Reports the Python, torch, and CUDA state. Returns 0 when CUDA is up,
    2 when CUDA is missing, 1 on a hard import error."""
    print("[image-to-3d] environment probe")
    print(f"  python version   : {sys.version.split()[0]}")
    try:
        import torch
    except ImportError as exc:
        print(f"  torch import FAILED: {exc}", file=sys.stderr)
        print(
            "  -> check the venv is activated and `pip install -r requirements.txt` completed.",
            file=sys.stderr,
        )
        return 1

    print(f"  torch version    : {torch.__version__}")
    print(f"  CUDA available   : {torch.cuda.is_available()}")

    if not torch.cuda.is_available():
        print(
            "  WARNING: CUDA not available. Pipelines will fall back to CPU (very slow).",
            file=sys.stderr,
        )
        return 2

    dev = torch.cuda.get_device_properties(0)
    print(f"  CUDA runtime     : {torch.version.cuda}")
    print(f"  GPU              : {dev.name}")
    print(f"  VRAM             : {dev.total_memory / (1024 ** 3):.2f} GB")
    print(f"  Compute          : {dev.major}.{dev.minor}")
    return 0


def probe_trellis() -> int:
    """Verify Trellis's native deps are importable (Task 4.1)."""
    print("[image-to-3d] trellis dependency probe")
    missing: list[str] = []
    for module in ("nvdiffrast", "xformers", "diff_gaussian_rasterization"):
        try:
            __import__(module)
            print(f"  {module:<35} OK")
        except ImportError:
            print(f"  {module:<35} MISSING", file=sys.stderr)
            missing.append(module)
    if missing:
        print(
            "Trellis deps missing. See README.md §Trellis setup for Windows wheel sources.",
            file=sys.stderr,
        )
        return 1
    return 0


def convert_image(
    input_path: Path,
    pipeline_name: str,
    output_dir: Optional[Path],
    remove_background: bool,
) -> int:
    # Validate pipeline before any heavy lifting — otherwise a --pipeline
    # trellis request would trigger rembg's 176 MB ONNX download before
    # landing on the "not yet implemented" stub.
    if pipeline_name == "trellis":
        print(
            "Trellis pipeline not yet implemented. Lands in Phase 4 "
            "(see tasks/image-to-3d-plan.md). Use --pipeline triposr for now.",
            file=sys.stderr,
        )
        return 10
    if pipeline_name != "triposr":
        raise ValueError(f"unknown pipeline: {pipeline_name}")

    # Deferred imports — skip heavy modules when the user only wants --probe.
    from output import export_scene_to_glb, resolve_output_path, write_sidecar_meta
    from preprocessing import load_and_prepare
    from pipelines.triposr import TripoSRPipeline

    total_start = time.perf_counter()

    _LOG.info("preprocessing %s (remove_background=%s)", input_path, remove_background)
    image = load_and_prepare(input_path, remove_background=remove_background)

    _LOG.info("running pipeline %s", pipeline_name)
    pipeline = TripoSRPipeline()
    extra_meta: dict[str, object] = {
        "chunk_size": pipeline.chunk_size,
        "mc_resolution": pipeline.mc_resolution,
        "device": pipeline.device,
    }

    scene = pipeline.generate(image)

    output_path = resolve_output_path(input_path.name, out_dir=output_dir)
    export_scene_to_glb(scene, output_path)
    meta_path = write_sidecar_meta(
        output_path,
        source_image=input_path,
        pipeline=pipeline_name,
        scene=scene,
        extra=extra_meta,
    )

    elapsed = time.perf_counter() - total_start
    print(f"OK ({elapsed:.1f} s)")
    print(f"  GLB  : {output_path}")
    print(f"  Meta : {meta_path}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Local image-to-3D converter (TripoSR + Trellis).",
    )
    parser.add_argument(
        "input",
        nargs="?",
        type=Path,
        help="Source image (JPG / PNG / WEBP). Omitted when using --probe.",
    )
    parser.add_argument(
        "--pipeline",
        choices=PIPELINE_CHOICES,
        default="triposr",
        help="Which model to run (default: triposr).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=(
            "Override the target directory. "
            "Default: <repo>/public/models/generated/"
        ),
    )
    parser.add_argument(
        "--no-bg-removal",
        action="store_true",
        help="Skip rembg; trust the input image's existing alpha channel.",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Print torch / CUDA / GPU environment info and exit.",
    )
    parser.add_argument(
        "--probe-trellis",
        action="store_true",
        help="Check that Trellis's native deps are importable and exit.",
    )
    return parser


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    parser = _build_parser()
    args = parser.parse_args()

    if args.probe:
        return probe()
    if args.probe_trellis:
        return probe_trellis()

    if args.input is None:
        parser.print_help(sys.stderr)
        return 64
    if not args.input.exists():
        print(f"input image not found: {args.input}", file=sys.stderr)
        return 66

    return convert_image(
        input_path=args.input,
        pipeline_name=args.pipeline,
        output_dir=args.output_dir,
        remove_background=not args.no_bg_removal,
    )


if __name__ == "__main__":
    raise SystemExit(main())
