"""TRELLIS WSL runner — invoked as a subprocess by pipelines/trellis.py.

Runs inside ~/trellis-venv on WSL. TRELLIS only runs on WSL on this rig
because of the Windows wheel walls documented in cffb462 (Task 4.1) — a
direct native install requires building four CUDA extensions from source
that don't ship Windows wheels for our torch 2.5.1+cu121 stack.

Emits structured progress events on stdout prefixed with "EVENT " so the
Windows-side wrapper can advance a progress bar; everything else is
human-readable log output that the wrapper logs but doesn't parse.

Events:
    EVENT pipeline_loaded elapsed=<seconds>
    EVENT inference_done elapsed=<seconds>
    EVENT export_done elapsed=<total_seconds> path=<glb>
"""
from __future__ import annotations

import os

# Set TRELLIS env vars BEFORE any heavy imports — they pin the attention
# backend and sparse-conv algorithm and have no effect once trellis is loaded.
os.environ.setdefault("ATTN_BACKEND", "xformers")
os.environ.setdefault("SPCONV_ALGO", "native")

import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRELLIS_DIR = HERE.parent / "external" / "TRELLIS"
if str(TRELLIS_DIR) not in sys.path:
    sys.path.insert(0, str(TRELLIS_DIR))


def main() -> int:
    parser = argparse.ArgumentParser(description="TRELLIS WSL runner")
    parser.add_argument("--in", dest="input_path", required=True, type=Path)
    parser.add_argument("--out", dest="output_path", required=True, type=Path)
    parser.add_argument("--simplify", type=float, default=0.95)
    parser.add_argument("--texture-size", type=int, default=2048)
    parser.add_argument("--ss-steps", type=int, default=12)
    parser.add_argument("--slat-steps", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not args.input_path.is_file():
        print(f"ERROR input not found: {args.input_path}", file=sys.stderr)
        return 2
    args.output_path.parent.mkdir(parents=True, exist_ok=True)

    from PIL import Image
    from trellis.pipelines import TrellisImageTo3DPipeline
    from trellis.utils import postprocessing_utils

    print("[trellis] loading TrellisImageTo3DPipeline from microsoft/TRELLIS-image-large ...", flush=True)
    t0 = time.perf_counter()
    pipeline = TrellisImageTo3DPipeline.from_pretrained("microsoft/TRELLIS-image-large")
    pipeline.cuda()
    load_elapsed = time.perf_counter() - t0
    print(f"[trellis] pipeline ready in {load_elapsed:.1f}s", flush=True)
    print(f"EVENT pipeline_loaded elapsed={load_elapsed:.2f}", flush=True)

    image = Image.open(args.input_path)
    print(
        f"[trellis] running inference on {args.input_path} "
        f"(size={image.size}, mode={image.mode}, ss_steps={args.ss_steps}, slat_steps={args.slat_steps})",
        flush=True,
    )
    t1 = time.perf_counter()
    outputs = pipeline.run(
        image,
        seed=args.seed,
        sparse_structure_sampler_params={"steps": args.ss_steps, "cfg_strength": 7.5},
        slat_sampler_params={"steps": args.slat_steps, "cfg_strength": 3.0},
    )
    inference_elapsed = time.perf_counter() - t1
    print(f"[trellis] inference done in {inference_elapsed:.1f}s", flush=True)
    print(f"EVENT inference_done elapsed={inference_elapsed:.2f}", flush=True)

    print(
        f"[trellis] exporting textured GLB to {args.output_path} "
        f"(simplify={args.simplify}, texture_size={args.texture_size})",
        flush=True,
    )
    glb = postprocessing_utils.to_glb(
        outputs["gaussian"][0],
        outputs["mesh"][0],
        simplify=args.simplify,
        texture_size=args.texture_size,
    )
    glb.export(str(args.output_path))
    total_elapsed = time.perf_counter() - t0
    print(f"[trellis] DONE. total {total_elapsed:.1f}s", flush=True)
    print(f"EVENT export_done elapsed={total_elapsed:.2f} path={args.output_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
