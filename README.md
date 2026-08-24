# F1 2026 Race Intelligence

**Live site:** https://devendrap7.github.io/F1-LAB/

An unofficial, non-commercial, open-source F1 2026 race-analysis site:
standings, race strategy, and — where the data allows — circuit atlases,
racing-line comparisons and aerodynamic analysis. Built as a static site
for GitHub Pages, with every figure computed at build time from public
data and nothing estimated to fill a gap.

See `DISCLAIMER.md` and `docs/SPEC.md` (full architecture and module
spec) before contributing.

## What is live

- **Season Ledger** — the 2026 championship, accumulated independently
  from each round's results and cross-checked against the published
  standings. The cross-check result is shown either way; a mismatch is a
  hard failure that blocks publication, not a warning to read past.
- **Race Strategy** — twelve races of real lap times (14,066 laps), with
  a stint chart, a lap-pace comparison for up to four drivers, an
  undercut ledger, and per-stint pace-trend fits.
- **Circuit Atlas** — the verified calendar. No track geometry; see
  "Where the data stops" below.

## Where the data stops

The site draws on two sources, and only one of them answers.

**Jolpica-F1** (the Ergast successor) serves the schedule, entry list,
results, standings, lap times and pit stops. Everything live on the site
comes from it.

**The Formula 1 live-timing service** is the only public source of car
position and telemetry — the channel behind racing lines, track maps,
corner analysis, tyre compounds and any aerodynamic estimate. It returns
**HTTP 403 to every request from a datacenter IP**, including its own
root and a prior-season control, so this is the network origin being
refused rather than anything specific to 2026. FastF1's own fallback
mirror answers but does not carry this season.

That was measured, not assumed. `pipeline/diagnose_sources.py` probes
every endpoint and prints the status codes; run it via the "Diagnose data
sources" workflow whenever the telemetry side goes quiet.

The consequence is deliberate and visible in the UI: modules that need
telemetry (Circuit Atlas geometry, Racing Lines, Driver Error Review,
Aero Explainer) show an empty state explaining the block. Drawing
approximate track outlines or inventing tyre compounds would look
finished and would be fabricated. Unblocking this needs ingest from a
residential IP or a self-hosted runner.

## Model limitations

Every figure the site derives carries its own caveat in the UI; the
substantive ones:

- **Per-stint pace trend is not a degradation rate.** Within one stint,
  fuel burn and tyre degradation are both close to linear in lap number
  and are not separately identifiable from lap times alone. The published
  slope is their sum plus track evolution, flagged `fuel_corrected:
  false`. A negative slope (the driver getting faster) is normal and is
  not evidence about tyres.
- **A fit is only called usable when it earns it.** Reliability requires
  both a sample-count floor and an R² floor. On real race data 57% of
  fits clear both; the rest are published with the reason they failed
  ("R² 0.06 below 0.3 — lap-to-lap scatter dominates any trend in this
  stint") rather than shown as a confident number.
- **No tyre compounds.** Jolpica-F1 publishes none, so stints are
  structural — when and how long — and are shaded by stint order, never
  by a compound colour.
- **Undercuts measure what happened, not what would have happened.**
  Gaps come from elapsed race time (the running sum of lap times).
  Pairings are excluded when the window cannot be about the stop — the
  rival stayed out beyond ten laps, either car stopped again inside it,
  lap data is missing, or the swing exceeds four pit losses — and the
  exclusion counts are shown alongside the table. Windows where the field
  was slowed are flagged rather than deleted, since without a
  track-status channel a neutralised period can only be suspected.
- **No track-status channel at all**, so safety-car and traffic laps are
  excluded from fits by an outlier rule rather than by flag.

## Not built yet

The What-If engine's core exists (`pipeline/models/whatif.py`, ported
line-for-line to `src/lib/whatifModel.js` and pinned by a two-sided
parity test) but is **not wired into any page**: the spec gates it on
reproducing a real race's time within 1% using the actual strategy, and
that test currently skips for want of fitted per-race parameters. It
stays unpublished until it passes.

Driver Error Review and the Aero Explainer are deliberate
`NotImplementedError` stubs — both need the telemetry that is blocked,
and the Aero module additionally needs
`config/regulations_2026.json` verified against the published FIA
technical regulations rather than filled in from memory.

## Running locally

```bash
npm install
npm run dev        # Vite dev server
npm test           # vitest
npm run build      # production build
```

```bash
pip install -r pipeline/requirements.txt
cd pipeline
python -m pytest tests -q          # 53 tests, no network required
python run_refresh.py --year 2026  # full refresh; needs network
python validate_export.py          # the same hard gate CI runs
python diagnose_sources.py         # probe every upstream source
```

To look at the built site the way GitHub Pages serves it — which is how
an axis-label collision and a console 404 were caught that the tests and
the build both passed:

```bash
npm run build && npm i --no-save playwright && node scripts/screenshot.mjs
```

Playwright is intentionally not a project dependency, so neither CI nor a
contributor's install pulls a browser.

## How the data gets there

`refresh-data.yml` runs weekly and on manual dispatch. It ingests, derives
and exports, then runs `validate_export.py` as a hard gate before
committing — and only then dispatches the Pages deploy, because a push
made with `GITHUB_TOKEN` does not fire `on: push` workflows.

The gate exists because there is no human review between a refresh and
the live site. It has already earned its place: a rate-limited run once
recomputed the championship from a partial set of rounds and published a
table with the leader 156 points short. The gate now hard-fails on a
flagged **or skipped** cross-check, the standings export aborts entirely
if any round fails to fetch, rate limits are retried rather than raised,
and exported artifacts carry a schema version so a corrected model
reaches rounds that were already written.

## Repository hygiene

`main` is the only branch. Commits are authored by the project owner (or
`github-actions[bot]` for the scheduled refresh).
