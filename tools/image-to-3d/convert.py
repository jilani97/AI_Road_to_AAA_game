"""Image-to-3D converter CLI.

Stage 0.2: environment probe only. The real conversion CLI (image input,
pipeline selection, output routing) lands in Task 1.4.

    python convert.py --probe
"""

from __future__ import annotations

import argparse
import sys


def probe() -> int:
    """Reports the Python, torch, and CUDA state. Returns 0 when CUDA is up,
    2 when CUDA is missing, 1 on a hard import error."""
    print("[image-to-3d] environment probe")
    print(f"  python version   : {sys.version.split()[0]}")
    try:
        import torch
    except ImportError as exc:
        print(f"  torch import FAILED: {exc}", file=sys.stderr)
        print("  -> check the venv is activated and `pip install -r requirements.txt` completed.",
              file=sys.stderr)
        return 1

    print(f"  torch version    : {torch.__version__}")
    print(f"  CUDA available   : {torch.cuda.is_available()}")

    if not torch.cuda.is_available():
        print("  WARNING: CUDA not available. Pipelines will fall back to CPU (very slow).",
              file=sys.stderr)
        return 2

    dev = torch.cuda.get_device_properties(0)
    print(f"  CUDA runtime     : {torch.version.cuda}")
    print(f"  GPU              : {dev.name}")
    print(f"  VRAM             : {dev.total_memory / (1024 ** 3):.2f} GB")
    print(f"  Compute          : {dev.major}.{dev.minor}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Image-to-3D converter (scaffolding stage).",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Print torch/CUDA/GPU environment info and exit.",
    )
    args, _ = parser.parse_known_args()

    if args.probe:
        return probe()

    print(
        "convert.py: no action taken. Use `--probe` to verify the environment.",
        file=sys.stderr,
    )
    print(
        "Full CLI (image input, --pipeline, --output-dir) lands in Task 1.4.",
        file=sys.stderr,
    )
    return 64  # EX_USAGE


if __name__ == "__main__":
    raise SystemExit(main())
