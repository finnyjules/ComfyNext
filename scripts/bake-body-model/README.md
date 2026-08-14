# bake-body-model — Anny transfer probe

Task 1 of the body-reference-builder plan (see `.superpowers/sdd/task-1-brief.md`
and `.superpowers/sdd/task-1-report.md` for the full writeup). Proves whether
nano-banana follows a grey parametric figure's proportions before a Body
editor gets built on top of the [Anny](https://pypi.org/project/anny/) body
model.

## Setup

```sh
cd scripts/bake-body-model
python3 -m venv venv
./venv/bin/pip install anny trimesh pyrender pillow
```

On this machine (macOS, Apple Silicon), `pyrender.OffscreenRenderer` worked
directly — it falls back to a pyglet-backed GL context and needed no
OSMesa/EGL setup. If it fails on your machine, fall back to
`trimesh.Scene.save_image` or an orthographic matplotlib triangle plot;
silhouette fidelity is what matters, not shading quality.

## Run

Requires the Sailor dev server running at `127.0.0.1:3000` (`./dev.sh` from
the repo root — **not** `localhost`, that hits the IPv6 listener and hangs).

```sh
./venv/bin/python probe.py
```

This **spends real money** — 3 `nano-banana` generations (~$0.40 total)
against the local dev server's `/api/inpaint/nano-gen` route. Everything
else (mesh building, phenotype dump, rendering) is free and local.

## License guard

The model is instantiated as `anny.Anny(topology="anny", ...)`. That spec
string resolves (see `anny/models/model_data.py::_parse_topology_spec`) to
`TopologyConfig(base_mesh="makehuman", ...)`. The `"makehuman"` base mesh
pulls assets from `anny/data/mpfb2/`, which the installed package's own
`LICENSE`/`README` state is **CC0 1.0 Universal** (MakeHuman assets adapted
from MPFB2). This is never the `"smplx"`/`"smpl"` alternative topology,
which Anny's README explicitly gates behind a separate non-commercial-only
download — that topology is never requested anywhere in this script.

## Outputs (gitignored, in `out/`)

- `phenotypes.txt` — full `model.phenotype_labels` + `model.local_change_labels` dump
- `slider-mapping.md` — 8 Body-editor slider ids → nearest real phenotype/local-change target
- `figure-default-{front,back}.png`, `figure-extreme-{front,back}.png` — rendered reference figures
- `gen-{control,default-ref,extreme-ref}.png` — the 3 paid nano-banana outputs
- `probe-contact-sheet.png` — labeled grid of all of the above

Copies of `phenotypes.txt`, `slider-mapping.md`, and `probe-contact-sheet.png`
are committed to `docs/superpowers/specs/assets/2026-08-13-body-probe/` for
posterity — the rest of `out/` and the `venv/` are gitignored.
