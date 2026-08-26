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

- Range filters are query-string conventions (`date>2026-08-23T13:00:00`), not typed params
- Honours `Retry-After` on 429
- Docs: https://openf1.org/ · https://github.com/br-g/openf1

### F1 live timing — tried, not used

`https://livetiming.formula1.com` — 403s datacenter IPs, so FastF1's telemetry path
is unusable from CI. OpenF1 replaced it.

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
react, react-dom, react-router-dom
dev: vite, @vitejs/plugin-react, vitest, eslint
not installed: playwright (npm i --no-save, for the screenshot scripts only)
```

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
- No DRS zone map — the feed's `drs` integer codes have no verified mapping here
- No scraping of any website
