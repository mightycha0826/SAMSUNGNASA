"""Fetch the pinned CC0 Blender Studio source bundle using only Python stdlib."""
from pathlib import Path
from urllib.request import urlretrieve
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent / 'source'
ARCHIVE = ROOT / 'human-base-meshes-bundle-v1.4.1.zip'
LIBRARY = ROOT / 'human_base_meshes_bundle.blend'
URL = 'https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip'
MEMBER = 'human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend'


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    if not ARCHIVE.exists():
        pending = ARCHIVE.with_suffix('.zip.part')
        print('Downloading the official Human Base Meshes v1.4.1 CC0 bundle...')
        urlretrieve(URL, pending)
        with ZipFile(pending) as archive:
            assert MEMBER in archive.namelist(), 'Expected Blender library missing'
        pending.replace(ARCHIVE)
    with ZipFile(ARCHIVE) as archive:
        # Write one known member to one fixed path, without extracting ZIP paths.
        LIBRARY.write_bytes(archive.read(MEMBER))
    print(f'Source ready: {LIBRARY.name} ({LIBRARY.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
