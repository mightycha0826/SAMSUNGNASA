# data-pipeline (slot C)

Downloads the NASA source data and processes it into the layer files in `web/public/data/`. What the files are is described in [docs/DATA.md](../docs/DATA.md).

## Run

Python 3.10 or later.

```bash
pip install -r requirements.txt
python build_data.py        # rebuild everything
python validate.py          # check the result (exit code 1 on failure)
```

- Rebuild one step: `python build_data.py optical` (`optical`, `thermal`, `topo`, `traverse`, `env`, `pov`, `layerset`)
- Redraw the figures: `python validate.py --figure` → `check_overlay.png`, `../docs/figures/`

The first run takes 3 to 4 minutes (measured: 211 seconds). Downloads are kept in `cache/`, about 100 MB (radiation 70 MB, atmosphere 13 MB, 183 tiles, the cropped terrain 16 MB), and are not fetched again. The terrain file (3.6 GB) is read over the network only for the rows needed. `cache/` is not committed.

**Without downloading from NASA:** the source files are published as one zip, the [source data bundle](https://github.com/mightycha0826/SAMSUNGNASA/releases/tag/source-data-2026-11-14) (25 MB). Unpack it with `python unpack_bundle.py marswalk-source-data-2026-11-14.zip` (the zip was made on Windows; a plain `unzip` on Linux or macOS does not recreate its folders) and `python build_data.py` finishes in a few seconds with no network access. Rebuilt on a different platform, the files match in content but not always byte for byte: checked on Linux aarch64, `thermal.png` had identical pixels with different PNG bytes, and `slope.bin` differed by at most 7.6e-6 degrees.

Rebuilding from an empty cache was confirmed to give files byte-identical to the ones in the repository (2026-11-14). The output and cache folders can be changed with the environment variables `MARSWALK_OUT` and `MARSWALK_CACHE`.

## Files

| File | Content |
|---|---|
| `build_data.py` | Processing script. The constants at the top hold the map extent, base and survey site, and source addresses |
| `validate.py` | Format checks, cross-checks between layers, slope criterion analysis |
| `validation_report.json` | The numbers `validate.py` computed. The figures in the docs come from here |
| `check_overlay.png` | Rover path laid over optical, terrain shading, slope and thermal |
| `reference_route.json` | Reference route from base to the survey site computed from the slope layer (list of cells). For comparison with D's route |
| `../docs/figures/` | English figures for the submission page and slides (`layers.png`, `route.png`), made by `validate.py --figure` |

## Things you may want to change

| To change | Constant in `build_data.py` | Steps to rerun |
|---|---|---|
| Base position | `BASE_RMC` (an `RMC` from the traverse record) | `layerset pov` |
| Survey site | `SURVEY_RMC` | `layerset pov` |
| Demo region size | `DEMO_HALF_CELLS` | `layerset` |
| Optical image size | `OPTICAL_PX` (2048 or 4096) | `optical` |
| Day of the radiation and weather record | `ENV_SOL`, `RAD_FILE`, `REMS_FILE` | `env` |

After a change, run `python validate.py` and make sure it passes.

## Use of AI

The scripts in this folder were written with the help of an AI coding tool (Claude). All data values were downloaded from the NASA and USGS addresses in the scripts.
