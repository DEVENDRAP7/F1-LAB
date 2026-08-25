"""Probe every upstream data source and report exactly how each one fails.

Exists because the pipeline's first real runs showed every FastF1 channel
failing on GitHub's runners while the Jolpica-F1 calls succeeded, and
FastF1 swallows the underlying exception behind a one-line warning
("Failed to load session info data!"). That warning is not a root cause:
an IP block, a changed upstream path, and a season with no published
live timing all look identical through it, and they need completely
different fixes.

This script makes the distinction visible: raw HTTP status codes for the
endpoints FastF1 depends on, then one FastF1 load with DEBUG logging so
the swallowed traceback is printed. Run it via the diagnose workflow
whenever the telemetry side of the pipeline goes quiet.

Read-only: it fetches and prints, and writes nothing to the repo.
"""
from __future__ import annotations

import argparse
import logging
import sys
import traceback

import requests

LIVETIMING_BASE = "https://livetiming.formula1.com"
JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"
# FastF1 3.8 falls back to this mirror on its own when livetiming 403s.
MIRROR_BASE = "https://livetiming-mirror.fastf1.dev"

# FastF1 reaches livetiming with its own UA; a plain requests default UA
# can be treated differently, so probe with both to tell a UA filter
# apart from a network-level block.
FASTF1_UA = "FastF1/"
DEFAULT_TIMEOUT = 20


def probe(url: str, headers: dict | None = None, note: str = "") -> None:
    label = f"{url}{f'  [{note}]' if note else ''}"
    try:
        resp = requests.get(url, headers=headers or {}, timeout=DEFAULT_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - reporting the failure IS the job
        print(f"  ERR  {label}\n         {type(exc).__name__}: {exc}")
        return

    body = resp.text[:180].replace("\n", " ").replace("\r", "")
    print(f"  {resp.status_code}  {label}")
    print(f"         server={resp.headers.get('server', '?')} "
          f"type={resp.headers.get('content-type', '?')} len={len(resp.content)}")
    if resp.status_code != 200 or len(body) < 180:
        print(f"         body: {body!r}")


def probe_http(year: int, round_: int) -> None:
    print(f"\n=== Raw HTTP probes ===")

    print("\nJolpica-F1 (the source that currently works):")
    probe(f"{JOLPICA_BASE}/{year}.json", note="season schedule")

    # Which Jolpica detail endpoints carry 2026 data decides how much of
    # the lap-level work (M4 stint structure, pace analysis) can be built
    # without telemetry at all.
    print("\nJolpica-F1 lap-level endpoints (telemetry-free fallback for M4):")
    probe(f"{JOLPICA_BASE}/{year}/{round_}/laps.json?limit=5", note="lap times")
    probe(f"{JOLPICA_BASE}/{year}/{round_}/pitstops.json?limit=5", note="pit stops")

    print("\nlivetiming.formula1.com (the source FastF1 needs):")
    probe(f"{LIVETIMING_BASE}/static/{year}/Index.json", note="season index, default UA")
    probe(
        f"{LIVETIMING_BASE}/static/{year}/Index.json",
        headers={"User-Agent": FASTF1_UA},
        note="season index, FastF1-style UA",
    )
    probe(f"{LIVETIMING_BASE}/static/StreamingStatus.json", note="service status")
    probe(f"{LIVETIMING_BASE}/", note="root")

    # A prior season is the control: if 2025 serves and 2026 does not, the
    # cause is upstream publication, not this runner's network.
    print(f"\nControl — prior season ({year - 1}) on the same host:")
    probe(f"{LIVETIMING_BASE}/static/{year - 1}/Index.json", note="prior-season index")

    # FastF1 3.8 falls back to this community mirror automatically. It
    # answers (so it is not blocked); the question is which seasons it
    # actually carries.
    print("\nFastF1 community mirror (reachable, coverage unknown):")
    probe(f"{MIRROR_BASE}/static/{year}/Index.json", note=f"{year} index")
    probe(f"{MIRROR_BASE}/static/{year - 1}/Index.json", note=f"{year - 1} index")
    probe(f"{MIRROR_BASE}/", note="root")


def probe_fastf1(year: int, round_: int, session_name: str) -> None:
    print(f"\n=== FastF1 load with DEBUG logging ({year} R{round_} {session_name}) ===")
    try:
        import fastf1
    except ImportError as exc:
        print(f"  fastf1 not installed: {exc}")
        return

    # Surface the traceback FastF1 hides behind its warning.
    logging.basicConfig(level=logging.DEBUG, stream=sys.stdout,
                        format="  %(levelname)s %(name)s: %(message)s")
    try:
        fastf1.set_log_level("DEBUG")
    except Exception:  # noqa: BLE001 - older/newer API shapes
        pass

    try:
        session = fastf1.get_session(year, round_, session_name)
        print(f"  get_session OK: {session}")
        session.load(laps=True, telemetry=False, weather=False, messages=False)
        print(f"  load() returned; laps={len(session.laps)}")
    except Exception:  # noqa: BLE001
        print("  load() raised:")
        traceback.print_exc(file=sys.stdout)


def probe_circuit_history(circuit_id: str, years: list[int]) -> None:
    """Report what past editions of one circuit are actually queryable.

    The Upcoming Race Brief is built from priors at the circuit the next
    round visits, so before any of it is written the question is which
    circuit-scoped endpoints answer and what shape they answer in. Prints
    the record count and the keys of one record per endpoint, because
    writing a parser against a remembered schema is how a field ends up
    silently absent.
    """
    print(f"\n=== Jolpica-F1 circuit history: {circuit_id} ===")
    for year in years:
        for endpoint in ("results", "pitstops", "qualifying"):
            url = f"{JOLPICA_BASE}/{year}/circuits/{circuit_id}/{endpoint}.json?limit=100"
            try:
                resp = requests.get(url, timeout=DEFAULT_TIMEOUT)
            except Exception as exc:  # noqa: BLE001
                print(f"  ERR  {year} {endpoint}: {type(exc).__name__}: {exc}")
                continue
            if not resp.ok:
                print(f"  {resp.status_code}  {year} {endpoint}")
                continue
            mrdata = resp.json()["MRData"]
            races = mrdata.get("RaceTable", {}).get("Races", [])
            total = mrdata.get("total")
            if not races:
                print(f"  200  {year} {endpoint}: total={total}, no races")
                continue
            race = races[0]
            listkey = next(
                (k for k in ("Results", "PitStops", "QualifyingResults") if k in race),
                None,
            )
            rows = race.get(listkey, []) if listkey else []
            sample = sorted(rows[0].keys()) if rows else []
            print(
                f"  200  {year} {endpoint}: total={total} round={race.get('round')} "
                f"rows={len(rows)} key={listkey} fields={sample}"
            )
            if endpoint == "results" and rows:
                # The status vocabulary is not stable across seasons
                # ("+1 Lap" in 2022, "Lapped" in 2025), so pair it with
                # positionText: a letter there marks a car that did not
                # take a classified finish, independent of wording.
                pairs = sorted({(r.get("positionText"), r.get("status")) for r in rows})
                nonnumeric = [p for p in pairs if not str(p[0]).isdigit()]
                print(f"         positionText/status non-numeric: {nonnumeric}")
                print(f"         numeric statuses: "
                      f"{sorted({p[1] for p in pairs if str(p[0]).isdigit()})}")
                round_ = race.get("round")
                stops_url = f"{JOLPICA_BASE}/{year}/{round_}/pitstops.json?limit=100"
                try:
                    sresp = requests.get(stops_url, timeout=DEFAULT_TIMEOUT)
                    if sresp.ok:
                        sdata = sresp.json()["MRData"]
                        sraces = sdata.get("RaceTable", {}).get("Races", [])
                        srows = sraces[0].get("PitStops", []) if sraces else []
                        print(f"         round-scoped pitstops: total={sdata.get('total')} "
                              f"fields={sorted(srows[0].keys()) if srows else []}")
                    else:
                        print(f"         round-scoped pitstops: {sresp.status_code}")
                except Exception as exc:  # noqa: BLE001
                    print(f"         round-scoped pitstops ERR: {type(exc).__name__}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--session", type=str, default="Q")
    parser.add_argument(
        "--circuit",
        type=str,
        default="",
        help="circuitId to probe past editions of; skipped when empty",
    )
    args = parser.parse_args()

    if args.circuit:
        probe_circuit_history(args.circuit, [args.year - n for n in range(1, 5)])
        return 0

    probe_http(args.year, args.round)
    probe_fastf1(args.year, args.round, args.session)
    print("\nDone. Read the status codes above before changing any ingest code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
