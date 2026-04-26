"""Clone Microsoft TRELLIS into external/TRELLIS/ and pin it to a known commit.

TRELLIS upstream (https://github.com/microsoft/TRELLIS, MIT) ships as a research
repo with a Linux/conda setup script and no `pip install`-able package, so we
vendor it the same way as TripoSR / InstantMesh and let `pipelines/trellis.py`
add it to sys.path at import time.

Inference also needs four CUDA-built native extensions that aren't on PyPI:
  - nvdiffrast (NVlabs)
  - diffoctreerast (JeffreyXiang)
  - diff-gaussian-rasterization (mip-splatting submodule)
  - vox2seq (vendored inside TRELLIS itself at extensions/vox2seq)

This script clones the first three into external/TRELLIS-extensions/. The
fourth lives inside the TRELLIS tree already. Building them is a separate
step — pip install of each path requires MSVC + CUDA toolkit on Windows.
See README "Trellis setup" for the wheel-or-build matrix.

Usage:
    .venv/Scripts/python install_trellis.py

Re-running updates each clone to its pinned commit.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXTERNAL = ROOT / "external"

TRELLIS_REPO = "https://github.com/microsoft/TRELLIS.git"
TRELLIS_COMMIT = "442aa1e1afb9014e80681d3bf604e8d728a86ee7"
TRELLIS_DIR = EXTERNAL / "TRELLIS"

# Native extensions cloned alongside TRELLIS — pinned to the SHAs upstream's
# setup.sh implicitly fetches at HEAD. Bumping these requires a re-test.
NATIVE_EXTS: tuple[tuple[str, str, str], ...] = (
    (
        "nvdiffrast",
        "https://github.com/NVlabs/nvdiffrast.git",
        "253ac4fcea7de5f396371124af597e6cc957bfae",
    ),
    (
        "diffoctreerast",
        "https://github.com/JeffreyXiang/diffoctreerast.git",
        "b09c20b84ec3aace4729e6e18a613112320eca3a",
    ),
    (
        "mip-splatting",
        "https://github.com/autonomousvision/mip-splatting.git",
        "dda02ab5ecf45d6edb8c540d9bb65c7e451345a9",
    ),
)


def _run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"$ {' '.join(cmd)}", file=sys.stderr)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def _vendor(name: str, url: str, commit: str, target: Path, *, recurse: bool = False) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not (target / ".git").exists():
        clone_cmd = ["git", "clone"]
        if recurse:
            clone_cmd.append("--recurse-submodules")
        clone_cmd.extend([url, str(target)])
        _run(clone_cmd)
    else:
        print(f"{target} already cloned — fetching updates …", file=sys.stderr)
        _run(["git", "fetch", "origin"], cwd=target)
    _run(["git", "checkout", commit], cwd=target)
    if recurse:
        _run(["git", "submodule", "update", "--init", "--recursive"], cwd=target)


def main() -> int:
    EXTERNAL.mkdir(parents=True, exist_ok=True)

    _vendor("TRELLIS", TRELLIS_REPO, TRELLIS_COMMIT, TRELLIS_DIR, recurse=True)
    for required in (TRELLIS_DIR / "trellis", TRELLIS_DIR / "configs"):
        if not required.is_dir():
            print(
                f"ERROR: expected {required} to exist after clone. "
                "Upstream layout may have changed.",
                file=sys.stderr,
            )
            return 1

    ext_root = EXTERNAL / "TRELLIS-extensions"
    for name, url, commit in NATIVE_EXTS:
        recurse = name == "mip-splatting"
        _vendor(name, url, commit, ext_root / name, recurse=recurse)

    print(f"TRELLIS ready at {TRELLIS_DIR} (pinned to {TRELLIS_COMMIT[:8]})")
    print(f"Native ext sources at {ext_root}/ — pip install each path to build.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
