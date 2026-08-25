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
  The ledger also carries a points-progression chart and a
  mathematical-elimination calculator, the latter on the most
  conservative bound available: a driver is counted out only when
  maximum points from every remaining round still leaves them short of
  the leader's current total.
- **Upcoming** — a brief for the next round, built only from past
  editions of the same circuit: finish rate, places moved from the grid,
  the winner's grid slot and stops per driver, each shown with the
  sample it came from. It is a record, not a forecast, and the page
  leads with that — 2026 is a regulation reset, so the cars behind those
  numbers are not the cars about to race.
- **Circuit Atlas** — the verified calendar, plus track outlines traced
  from real position telemetry. Each outline is one measured lap's
  driven path, so it follows the racing line rather than the centre
  line, and it says so. No corner numbering: the source publishes none.
- **Racing Lines** — per-driver fastest race laps decoded from Int16
  position binaries, with linked speed and throttle traces on a shared
  distance axis. The position unit is measured per round, not assumed.

## Where the data comes from

Three public sources, none of them official.

**Jolpica-F1** (the Ergast successor) serves the schedule, entry list,
results, standings, lap times and pit stops — the whole championship
side of the site, plus the historical priors behind the Upcoming brief.

**OpenF1** serves car position (x/y/z), car telemetry (speed, throttle,
brake, gear, DRS, rpm), stints with tyre compounds, race-control flags
including safety cars, and intervals. The track outlines and racing
lines are built from it.

**The Formula 1 live-timing service** returns **HTTP 403 to every
request from a datacenter IP**, including its own root and a
prior-season control, so this is the network origin being refused rather
than anything specific to this season. FastF1 depends on it and is
therefore unavailable here.

That last finding is measured, not assumed — `pipeline/diagnose_sources.py`
probes every endpoint and prints status codes; run it via the "Diagnose
data sources" workflow.

### A correction worth recording

For most of this project's life that 403 was documented here as the
reason four modules shipped permanently empty. That was an overreach.
The 403 establishes that *one host* refuses this network; it says
nothing about whether the underlying data is obtainable elsewhere, and
nobody had checked. OpenF1 answers 200 from the same runners and carries
the same channels, so Racing Lines and Circuit Atlas geometry are now
built from real position traces.

The lesson is kept in the repo rather than quietly edited away: a
measurement ("this host refuses us") and a conclusion ("this data cannot
be had") are different claims, and the gap between them cost this
project four modules.

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
- **The Upcoming brief's priors are weak by construction.** They come
  from at most four past editions of one circuit, under a different set
  of technical regulations, and every figure is rendered with its sample
  count for that reason. Classification keys off `positionText`, not the
  status text: the same lapped-but-classified finisher reads `+1 Lap` in
  2022 and `Lapped` in 2025, so matching on status would have counted
  every lapped 2025 finisher as a retirement.

## Not built yet

The What-If engine's core exists (`pipeline/models/whatif.py`, ported
line-for-line to `src/lib/whatifModel.js` and pinned by a two-sided
parity test) but is **not wired into any page**: the spec gates it on
reproducing a real race's time within 1% using the actual strategy, and
that test currently skips for want of fitted per-race parameters. It
stays unpublished until it passes.

Driver Error Review and the Aero Explainer are deliberate
`NotImplementedError` stubs. Their input data now exists — OpenF1
carries the telemetry and a race-control feed with real safety-car
periods — so the blocker on both is implementation, not availability.
The Aero module additionally needs `config/regulations_2026.json`
verified against the published FIA technical regulations rather than
filled in from memory.

The telemetry backfill is incremental: each refresh builds at most four
rounds, newest first, and skips rounds already exported. Rounds 9, 10
and 12 have lines and outlines; the rest fill in over successive runs.

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
