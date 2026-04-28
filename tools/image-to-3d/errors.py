"""User-facing error messages for pipeline failures.

The pipelines raise low-level exceptions (`torch.cuda.OutOfMemoryError`,
`subprocess` exit codes from the WSL Trellis runner, etc.). The CLI and
the Gradio UI both want short, actionable messages instead — "try a
different pipeline" / "check the WSL setup" / "your input is too small".
This module translates between the two.
"""

from __future__ import annotations

PIPELINE_OOM_HINTS: dict[str, str] = {
    "triposr": (
        "TripoSR ran out of VRAM. Try a smaller input, or pass --no-bg-removal "
        "if rembg is contributing to the peak."
    ),
    "instantmesh": (
        "InstantMesh ran out of VRAM. Stage 2 (LRM at instant-mesh-large) "
        "peaks ~20 GB on the triplane query — the 8 GB target rig handles it "
        "via Windows WDDM oversubscription, paying ~4× wall-clock. If the "
        "OS-level fallback is also exhausted, switch to TripoSR."
    ),
    "trellis": (
        "Trellis ran out of VRAM in WSL. Default settings need ~6 GB peak; "
        "if you're hitting OOM, drop `texture_size` to 1024 in pipelines/trellis.py "
        "or switch to InstantMesh / TripoSR."
    ),
}


def is_oom(exc: BaseException) -> bool:
    """Detect CUDA OOM from either the torch-typed exception or a generic
    RuntimeError carrying the message (the message form shows up when the
    OOM bubbles through a subprocess + parser stack like Trellis-WSL)."""
    msg = str(exc).lower()
    if "out of memory" in msg or "cuda oom" in msg:
        return True
    # `torch.cuda.OutOfMemoryError` is a RuntimeError subclass; fall through
    # to type check for callers that have torch imported.
    cls = type(exc).__name__.lower()
    return "outofmemory" in cls


def friendly_pipeline_error(exc: BaseException, pipeline_name: str) -> str:
    """Return a one-paragraph message suitable for stderr or a Gradio toast.
    The original exception is *not* swallowed — the caller still re-raises
    or logs the underlying traceback."""
    if is_oom(exc):
        hint = PIPELINE_OOM_HINTS.get(pipeline_name, "Try a different pipeline.")
        return f"{pipeline_name}: CUDA out of memory. {hint}"
    return f"{pipeline_name} failed: {exc}"
