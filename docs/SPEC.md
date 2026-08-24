# F1 2026 Race Intelligence — Engineering Spec

A public, open-source F1 2026 race-analysis site: circuit atlases, standings,
racing-line comparisons, tyre-strategy modeling, a what-if race simulator,
driver error review, and an aerodynamics explainer, all served as a static
site on GitHub Pages.

## Ground rules

1. Real data only. No mock lap times, no invented standings, no synthetic
   telemetry. An empty state beats a fake one.
2. Every derived metric ships with its formula. A statement like "driver X
   lost 1.4s at Turn 4" reveals its inputs on hover: reference lap, delta
   method, sample window.
3. Counterfactuals are labeled as models ("the model estimates"), never
   stated as fact.
4. Mistake detection is a flag, not an accusation, and links to the
   triggering telemetry. Flags are dismissable.
5. No F1/FIA/team logos or liveries — see `DISCLAIMER.md`.
6. Season facts (calendar, results, standings, entry list, regulation
   constants) are never hardcoded from memory — they come from the data
   layer or versioned config, verified against the live API/regulations on
   first run.

## Hosting constraint

GitHub Pages serves static files only: no server, no runtime Python, no
database, no request-time API. Everything splits along that line:

```
BUILD TIME (GitHub Actions, Python)      RUN TIME (browser, JS)
──────────────────────────────────       ────────────────────────
FastF1 ingest                            fetch() static JSON/binary
Lap/stint normalization                  render maps, traces, charts
Racing-line geometry + resampling        interactive filtering
Degradation curve fitting                what-if Monte Carlo (Web Worker)
Mistake detection                        corner-by-corner deltas
Aero coefficient estimation              all UI state
Standings computation
        ↓ writes ↓
   static artifacts committed to the repo
```

Anything that needs FastF1, pandas, or scipy happens at build time in
`pipeline/`. Anything that responds to a click happens in the browser.
There is no FastAPI backend; `scripts/serve_dev.py` (if present) only
serves the `public/` folder for local development.

### Deployment mechanics

- Vite + React, `base` matching the repo name so assets resolve on Pages.
- `HashRouter`, not `BrowserRouter` — Pages has no server-side rewrite.
- Deploy via `actions/upload-pages-artifact` + `actions/deploy-pages` from
  `main`. No `gh-pages` branch.
- No secrets reach the client. Anything needing a key (e.g. a weather
  forecast) is called at build time and baked into committed JSON.
- Everything under `public/data/` is fetched at runtime by relative URL,
  resolved with `import.meta.env.BASE_URL`, never a leading `/`.

### Payload budget

| Scope | Budget |
|---|---|
| Whole site | < 300 MB |
| Any single file | < 20 MB |
| Initial page load | < 400 KB |
| One session's data, lazy-loaded | < 3 MB |
| One driver's racing line | < 60 KB |

Achieved by: resampling position data to fixed 2-metre distance spacing,
quantizing to Int16 (decimetres for X/Y, km/h ×10 for speed, 0–100 for
throttle, a bitmask for brake), storing racing lines as raw little-endian
`.bin` typed arrays with a `manifest.json` declaring channel order,
offsets, lengths and scale factors (the JS layer reads the manifest, it
never guesses layout), and exporting only the fastest lap per session plus
any flagged lap — not full-race telemetry. Lap times, stints, results and
standings stay as plain JSON since they're small and diffable.

### Actions workflows

- `refresh-data.yml` — cron (Tuesdays) + `workflow_dispatch`. Caches the
  FastF1 cache directory keyed on session ID. Runs
  `pipeline/ingest.py → derive.py → export.py` for rounds with new
  sessions. Runs validation (self-checks, budget checks) as a hard gate —
  it aborts the commit on any failure, since commits land directly on
  `main` with no review step.
- `deploy.yml` — on push to `main`: build, test, deploy to Pages, with a
  concurrency group so overlapping runs cancel.

### Accepted trade-offs

- Only exported laps are explorable; the UI states which laps are
  available.
- The what-if Monte Carlo runs client-side in a Web Worker, budgeted to
  ~1,000 iterations with a visible progress state.
- Data is only as fresh as the last Action run; every page is stamped with
  the generation time of its artifacts.

## Data sources

| Need | Source |
|---|---|
| Sessions, laps, stints, pit stops, weather, telemetry, X/Y position | FastF1 (wraps the official live-timing service) |
| Standings, results, schedule | Jolpica-F1 (Ergast-compatible, rate-limited) |
| Corner numbers, marshal sectors, track rotation | `session.get_circuit_info()` |
| Track-limit deletions, penalties | FIA event documents (PDF parse; manual fallback acceptable) |

The 2026 calendar and entry list are verified from the API on first run
and written to `config/season_2026.json` — never typed from memory.

FastF1 notes: rotate X/Y by `circuit_info.rotation`; X/Y are in
decimetres in a track-local frame; use `pick_accurate()` for pace work but
keep inaccurate laps for incident detection; merge car + position data
then `add_distance()` — distance is the x-axis for every comparison, never
time; telemetry can be partial per driver/session (degrade per-driver, not
per-page); sprint weekends have a different session set and must be
detected, not assumed.

Pipeline stages are idempotent and accept `--year --round --session`.

```
public/data/
  season.json                       # calendar, entry list, generated_at
  standings.json
  circuits/{key}.json
  2026/{round}/{session}/
    meta.json  laps.json  stints.json  incidents.json  deg_model.json
    lines/{code}.bin      lines/manifest.json
```

## Modules

1. **Circuit Atlas** — track outline from the fastest qualifying lap's
   position trace, numbered corners with entry/min speed, apex distance,
   gear, braking point; elevation; DRS zones. Per-circuit constants carry a
   `source` field. `pit_loss_s` is measured, not guessed.
2. **Season Ledger** — per-round results; standings computed independently
   and cross-checked against the API, with a warning banner on mismatch;
   points-progression chart; elimination calculator.
3. **Racing Lines** — up to 4 overlaid driven lines, filterable by session/
   lap/color channel, linked to distance-axis telemetry traces and a
   delta-time trace, plus a corner table ranked by time lost. Binary
   telemetry decodes straight into typed arrays.
4. **Tyre Strategy Board** — stint chart, undercut/overcut ledger,
   degradation model per compound per event
   (`lap_time ≈ base + deg_rate × tyre_life`, optionally quadratic), with
   published coefficients, R², sample count and exclusions.
5. **What-If Engine** — lap-by-lap projection
   (`predicted_lap = base_pace + deg − fuel_effect × fuel_remaining +
   traffic_penalty + track_evolution`), pit stops costing the measured
   `pit_loss_s`, ≥1,000 Monte Carlo iterations reported as a distribution
   (never a point estimate), with a sensitivity panel. Runs in a Web
   Worker as a direct port of `pipeline/models/whatif.py`, tested for
   parity against the Python reference. Gated on reproducing the actual
   race result within ~1% when run with the actual strategy.
6. **Upcoming Race Brief** — historical priors only, with sample counts
   and an explicit low-confidence banner given the 2026 regulation reset.
7. **Driver Error Review** — per-driver flagged timeline (lock-ups,
   off-track, mid-corner corrections, poor exits, bad launches, slow in/
   out laps, track-limit facts from FIA documents), each flag carrying
   lap, corner, estimated time loss, severity, triggering telemetry window
   and a plain-English line. Language stays descriptive ("flagged",
   "estimated", "deviation from personal norm"), never accusatory.
8. **Aero Explainer** — apparent drag (`F_drag = ½ρv²C_dA`) fit from a
   straight-line speed trace; apparent downforce from `a_lat = v²/r` vs.
   speed; an efficiency map; an interactive corner simulator; 2026 active-
   aero and power-unit specifics read from
   `config/regulations_2026.json`, verified against the published FIA
   technical regulations rather than recalled from memory. Airflow visuals
   stay schematic — no fabricated CFD.

## Repository hygiene

- `main` is the only branch; the data-refresh workflow commits straight to
  it, and Pages deploys via `upload-pages-artifact`/`deploy-pages`, which
  creates no branch.
- Every commit is authored by the project owner (or `github-actions[bot]`
  for the scheduled workflow) — no assistant attribution in commit
  trailers, PR bodies, or file contents.

## Build order

One circuit/session end-to-end, then Season Ledger, Racing Lines, Tyre
Strategy, full Circuit Atlas, What-If (gated on its validation test),
Error Review, Aero Explainer, Upcoming Brief, then README/screenshots/
deploy. Each stage ships working before the next begins.
