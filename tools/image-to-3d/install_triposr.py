"""Clone TripoSR into external/TripoSR/ and pin it to a known commit.

TripoSR upstream (https://github.com/VAST-AI-Research/TripoSR, MIT) ships
without a setup.py / pyproject.toml, so it can't be `pip install`'d from git.
Instead we vendor it as a sibling source tree and let
`pipelines/triposr.py` add it to sys.path at import time.

Usage:
    .venv/Scripts/python install_triposr.py

Re-running updates the clone to the pinned commit — safe to invoke any time.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_URL = "https://github.com/VAST-AI-Research/TripoSR.git"
# Pinned to a known-good revision. Update deliberately — the API has
# historically been stable but we don't want surprise upstream breakage.
PINNED_COMMIT = "d26e33181947bbbc4c6fc0f5734e1ec6c080956e"

TARGET = Path(__file__).resolve().parent / "external" / "TripoSR"


def _run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"$ {' '.join(cmd)}", file=sys.stderr)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def main() -> int:
    TARGET.parent.mkdir(parents=True, exist_ok=True)

    if not (TARGET / ".git").exists():
        _run(["git", "clone", REPO_URL, str(TARGET)])
    else:
        print(f"{TARGET} already cloned — fetching updates …")
        _run(["git", "fetch", "origin"], cwd=TARGET)

    _run(["git", "checkout", PINNED_COMMIT], cwd=TARGET)

    tsr_dir = TARGET / "tsr"
    if not tsr_dir.is_dir():
        print(
            f"ERROR: expected {tsr_dir} to exist after clone. "
            "Upstream repo layout may have changed.",
            file=sys.stderr,
        )
        return 1

    print(f"TripoSR ready at {TARGET} (pinned to {PINNED_COMMIT[:8]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
