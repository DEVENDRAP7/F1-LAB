# Sources, endpoints and dependencies

Everything this project reads, runs on, or deliberately does not use.

## Data sources

### Jolpica-F1 (Ergast successor)

Base: `https://api.jolpi.ca/ergast/f1`

| Endpoint | Used for |
|---|---|
| `/{year}` | calendar |
| `/{year}/drivers` | entry list |
| `/{year}/driverStandings` | standings cross-check |
| `/{year}/{round}/driverStandings` | standings after each round |
| `/{year}/{round}/results` | race results |
| `/{year}/{round}/sprint` | sprint results |
| `/{year}/{round}/qualifying` | Q1/Q2/Q3 times + constructor |
| `/{year}/{round}/laps` | every driver, every lap |
| `/{year}/{round}/pitstops` | stop lap + stationary duration |
| `/{year}/circuits/{circuitId}/results` | past editions for the Upcoming brief |

- Paged with `limit=100&offset=` (100 is the API's own maximum)
- Honours `Retry-After` on 429
- Docs: https://github.com/jolpica/jolpica-f1 · https://api.jolpi.ca/ergast/

### OpenF1

Base: `https://api.openf1.org/v1`

| Endpoint | Used for |
|---|---|
| `/sessions?year=&session_name=Race\|Qualifying` | session keys per round |
| `/drivers?session_key=` | car number to driver code |
| `/laps?session_key=` | lap times, pick the fastest |
| `/stints?session_key=` | tyre compounds |
| `/race_control?session_key=` | flags, safety cars, penalties |
| `/location?session_key=&driver_number=&date>…&date<…` | x/y/z position |
| `/car_data?session_key=&driver_number=&date>…&date<…` | speed, throttle, brake, n_gear, drs, rpm |
| `/weather?session_key=` | air and track temperature, humidity, pressure, wind, rainfall flag |
| `/overtakes?session_key=` | position changes during a race (beta) |
| `/team_radio?session_key=` | broadcast radio clip metadata and `recording_url` |

- Range filters are query-string conventions (`date>2026-08-23T13:00:00`), not typed params
- Honours `Retry-After` on 429
- Docs: https://openf1.org/ · https://github.com/br-g/openf1

### Open-Meteo historical archive

Base: `https://archive-api.open-meteo.com/v1/archive`

| Query | Used for |
|---|---|
| `latitude=&longitude=&start_date=&end_date=&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&timezone=UTC` | an independent second measurement of session conditions |

- No API key. Data licence CC BY 4.0 — https://open-meteo.com/
- Coordinates come from Jolpica's own `Circuit.Location`, never typed in
- The only quantity both this and OpenF1 measure is air temperature, and comparing
  them is the point: it is the second cross-source check in the project

### F1 live timing — tried, not used

`https://livetiming.formula1.com` — 403s datacenter IPs, so FastF1's telemetry path
is unusable from CI. OpenF1 replaced it.

### Aero Rig car model — third party, CC-BY-4.0

The 3D car on `/aero-rig` is **not** this project's geometry. It is:

> "F1 2026 concept (polygon model)"
> (<https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42>)
> by Qvist_designs (<https://sketchfab.com/Qvist_Designs>)
> licensed under CC-BY-4.0 (<http://creativecommons.org/licenses/by/4.0/>).

Changes made: decimated to 16% of its original 1.16M triangles, re-cut by
`scripts/model/segment_car.py` into the thirteen parts the page names, given
materials, and re-exported Draco-compressed. The donor file is kept under
`scripts/model/donor/` with its original licence text so the derivation stays
reproducible.

Attribution is a **condition of the licence, not a courtesy** — without it there
is no permission to use the model at all — so the credit appears under the
viewer on the page itself as well as here.

What this means for the page's claims: the car's *shape* is an artist's
interpretation of the 2026 regulations, not something derived here, and the
page says exactly that in its banner and in every part's verdict. Only the
numbers around the car are measured. Two parts are additionally approximate,
and say so: the front flap (the donor does not split the movable elements from
the fixed mainplane) and the suspension (wishbones cannot be separated from
wheels and bodywork by position alone).

## Hosting and CI

- GitHub Pages, via `actions/upload-pages-artifact` + `actions/deploy-pages`
- `.github/workflows/refresh-data.yml` — weekly cron + manual dispatch
- `.github/workflows/deploy.yml` — build and publish
- `.github/workflows/diagnose.yml` — source reachability probe

## Dependencies

Python (`pipeline/requirements.txt`):

```
fastf1>=3.4     # installed, unusable from CI (see live timing above)
requests>=2.31
numpy>=1.26
scipy>=1.11
pandas>=2.1
pytest>=8.0
```

JavaScript (`package.json`):

```
react, react-dom, react-router-dom, three
dev: vite, @vitejs/plugin-react, vitest, eslint
not installed: playwright (npm i --no-save, for the screenshot scripts only)
```

`three` renders the Aero Rig's 3D car — lazy-loaded on `/aero-rig` alone, via
`React.lazy`, so it never lands in the initial bundle any other page pays for.

`eslint.config.js` is core ESLint only, with no React plugin: `no-unused-vars`
is therefore off for `.jsx`, where a component used only inside JSX reads as
unused. Adding `eslint-plugin-react` would fix that and is the obvious next
dependency to consider — it is left out because adding one is a stack change
this project asks about first.

## Written here, not sourced

- `docs/SPEC.md` — the project brief
- `config/season_2026.json` — generated from Jolpica, never typed by hand
- `config/model.json`, `DISCLAIMER.md`
- Colour tokens in `src/theme/tokens.css` — validated with a palette checker, not copied
- Every model: curvature fit, aero, tyre degradation, what-if, corner detection,
  mini-sectors, qualifying head-to-head

## Deliberately not used

- No official F1 or FIA API, no team data, no logos or liveries
- No FIA technical regulations document — which is why the 2026 aero and power-unit
  constants are still absent rather than recalled
- No DRS zone map. The `drs` integer codes were chased properly rather than
  assumed unavailable: FastF1's own `car_data` docstring is the most detailed
  public account of them and reads `0-14 (Odd DRS is Disabled, Even DRS is
  Enabled?) (More Research Needed?)`, with `2` and `3` marked `(?)` and `10`,
  `12` and `14` all `On (Unknown Distinction)`. The best public source says it
  does not know, so this project does not either
- No audio, and no transcripts of any audio. Team radio is published here as
  metadata with a link to the clip at its own host; converting speech to text
  would put this project's paraphrase where a quotation belongs, and the
  validation gate fails a radio document carrying any text-bearing field
- No scraping of any website
