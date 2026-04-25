"""Clone InstantMesh into external/InstantMesh/ and pin it to a known commit.

InstantMesh upstream (https://github.com/TencentARC/InstantMesh, Apache 2.0)
ships without a setup.py / pyproject.toml, so it can't be `pip install`'d from
git. Same convention as TripoSR — vendor it as a sibling source tree and let
`pipelines/instantmesh.py` add it to sys.path at import time.

Usage:
    .venv/Scripts/python install_instantmesh.py

Re-running updates the clone to the pinned commit — safe to invoke any time.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_URL = "https://github.com/TencentARC/InstantMesh.git"
PINNED_COMMIT = "08822c52fdc399b93ea00e4fa9e596344ed52ccc"

TARGET = Path(__file__).resolve().parent / "external" / "InstantMesh"


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

    src_dir = TARGET / "src"
    configs_dir = TARGET / "configs"
    zero123_dir = TARGET / "zero123plus"
    for required in (src_dir, configs_dir, zero123_dir):
        if not required.is_dir():
            print(
                f"ERROR: expected {required} to exist after clone. "
                "Upstream repo layout may have changed.",
                file=sys.stderr,
            )
            return 1

    print(f"InstantMesh ready at {TARGET} (pinned to {PINNED_COMMIT[:8]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
