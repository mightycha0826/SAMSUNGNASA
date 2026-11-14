#!/usr/bin/env python3
"""Unpack the source data bundle into data-pipeline/cache/ on any system.

    python unpack_bundle.py marswalk-source-data-2026-11-14.zip

The bundle was zipped on Windows, so its entry names use backslashes. A plain `unzip` on Linux
or macOS writes files with a backslash in the name instead of folders; this script turns the
separators into real folders. Then `python build_data.py` runs without downloading anything.
"""
import sys
import zipfile
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cache = Path(__file__).resolve().parent / "cache"
    count = 0
    with zipfile.ZipFile(sys.argv[1]) as z:
        for name in z.namelist():
            parts = [p for p in name.replace("\\", "/").split("/") if p]
            if not parts or name.endswith(("/", "\\")):
                continue
            if any(p in ("..", ".") or ":" in p for p in parts):   # never write outside cache/
                sys.exit(f"refusing odd path in the bundle: {name!r}")
            target = cache.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(name))
            count += 1
    print(f"{count} files unpacked into {cache}")


if __name__ == "__main__":
    main()
