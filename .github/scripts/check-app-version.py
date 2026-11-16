"""Check the shared app version, optionally against an app/vX.Y.Z release tag."""

import argparse
import json
from pathlib import Path
import re
import tomllib


def check_version(root: Path, tag: str = "") -> str:
    frontend = json.loads((root / "frontend/package.json").read_text())["version"]
    backend = tomllib.loads((root / "backend/pyproject.toml").read_text())["project"]["version"]
    lock = tomllib.loads((root / "backend/uv.lock").read_text())
    locked = next(p["version"] for p in lock["package"] if p["name"] == "backend")
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", frontend):
        raise ValueError("App version must be a stable X.Y.Z version")
    if frontend != backend or backend != locked:
        raise ValueError(f"App versions differ: frontend={frontend}, backend={backend}, uv.lock={locked}")
    if tag and tag != f"app/v{frontend}":
        raise ValueError(f"Expected tag app/v{frontend}, got {tag}")
    return frontend


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", default="", help="Release tag; omit for a version-only check")
    args = parser.parse_args()
    try:
        print(check_version(Path(__file__).resolve().parents[2], args.tag))
    except ValueError as error:
        parser.exit(1, f"{error}\n")
