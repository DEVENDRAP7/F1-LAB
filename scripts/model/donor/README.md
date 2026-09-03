# Donor model

`scene.bin` is **not committed** — it is 39 MB of third-party build input,
and what this repo ships is the derived `public/models/2026/car.glb` at
0.8 MB. `scene.gltf` and `license.txt` are kept so the provenance and the
mesh structure stay readable in the repo.

To rebuild the car you need the donor. Download

  F1 2026 concept (polygon model) — Qvist_designs — CC-BY-4.0
  https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42

as glTF, put `scene.bin` beside `scene.gltf` here, and run:

    pip install bpy==5.0.1        # CPython 3.11 only
    npm run model:build

See `docs/SOURCES.md` for what the licence requires and what was changed.
