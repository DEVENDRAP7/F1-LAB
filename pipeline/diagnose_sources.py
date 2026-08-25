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
# Independent of the F1 live-timing host, so it is not subject to the
# same origin block — whether it carries this season is a separate
# question the probe answers rather than assumes.
OPENF1_BASE = "https://api.openf1.org/v1"

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


def probe_openf1(year: int) -> None:
    """Probe OpenF1 for the channels livetiming.formula1.com refuses us.

    The 403 finding established that one *source* blocks datacenter IPs.
    It did not establish that the data is unobtainable, and those are
    very different conclusions — the first is about a host, the second
    would justify four permanently empty modules. OpenF1 is an
    independent public API that publishes car telemetry, car location,
    stints with compounds, intervals and race-control messages, which is
    close to the exact list this project is missing.

    So: does it answer from a runner, and does it carry 2026? Everything
    downstream of that question depends on the answer, so it gets
    measured rather than assumed. A prior season is probed as a control,
    exactly as the live-timing probe did, to tell "blocked" apart from
    "this season is not published".
    """
    print(f"\n=== OpenF1 ({year}, with {year - 1} as control) ===")

    for probe_year in (year, year - 1):
        url = f"{OPENF1_BASE}/sessions?year={probe_year}&session_name=Race"
        try:
            resp = requests.get(url, timeout=DEFAULT_TIMEOUT)
        except Exception as exc:  # noqa: BLE001
            print(f"  ERR  sessions {probe_year}: {type(exc).__name__}: {exc}")
            continue
        if not resp.ok:
            print(f"  {resp.status_code}  sessions {probe_year}: "
                  f"{resp.text[:120]!r}")
            continue

        sessions = resp.json()
        print(f"  200  sessions {probe_year}: {len(sessions)} race session(s)")
        if not sessions:
            continue

        first = sessions[0]
        last = sessions[-1]
        print(f"         first: key={first.get('session_key')} "
              f"{first.get('country_name')} {first.get('date_start')}")
        print(f"         last:  key={last.get('session_key')} "
              f"{last.get('country_name')} {last.get('date_start')}")
        print(f"         session fields: {sorted(first.keys())}")

        # Probe the actual channels against ONE real session key. A
        # sessions listing that answers proves nothing about whether the
        # heavy per-car channels are populated for it.
        key = last.get("session_key")
        for endpoint, params in (
            ("drivers", f"session_key={key}"),
            ("stints", f"session_key={key}"),
            ("laps", f"session_key={key}&lap_number=1"),
            ("race_control", f"session_key={key}"),
            ("intervals", f"session_key={key}"),
        ):
            _probe_openf1_channel(endpoint, params)

        # The two big ones, deliberately narrowed to a single driver and
        # a small window: these are the channels behind racing lines and
        # the aero fits, and they are large enough that an unfiltered
        # request is a bad citizen and a slow probe.
        drivers_url = f"{OPENF1_BASE}/drivers?session_key={key}"
        try:
            drv = requests.get(drivers_url, timeout=DEFAULT_TIMEOUT)
            number = drv.json()[0]["driver_number"] if drv.ok and drv.json() else None
        except Exception:  # noqa: BLE001
            number = None
        if number is not None:
            _probe_openf1_channel("car_data", f"session_key={key}&driver_number={number}&speed>=300")
            _probe_openf1_channel("location", f"session_key={key}&driver_number={number}")


def _probe_openf1_channel(endpoint: str, params: str) -> None:
    url = f"{OPENF1_BASE}/{endpoint}?{params}"
    try:
        resp = requests.get(url, timeout=60)
    except Exception as exc:  # noqa: BLE001
        print(f"    ERR  {endpoint}: {type(exc).__name__}: {exc}")
        return
    if not resp.ok:
        print(f"    {resp.status_code}  {endpoint}: {resp.text[:120]!r}")
        return
    rows = resp.json()
    fields = sorted(rows[0].keys()) if rows else []
    print(f"    200  {endpoint}: {len(rows)} row(s) fields={fields}")
    if endpoint == "stints" and rows:
        compounds = sorted({r.get("compound") for r in rows})
        print(f"           compounds: {compounds}")
    if endpoint == "race_control" and rows:
        categories = sorted({r.get("category") for r in rows})
        flags = sorted({r.get("flag") for r in rows if r.get("flag")})
        print(f"           categories: {categories}")
        print(f"           flags: {flags}")


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
    parser.add_argument(
        "--openf1",
        action="store_true",
        help="probe OpenF1 for the telemetry channels live timing refuses",
    )
    args = parser.parse_args()

    if args.circuit:
        probe_circuit_history(args.circuit, [args.year - n for n in range(1, 5)])
        return 0

    if args.openf1:
        probe_openf1(args.year)
        return 0

    probe_http(args.year, args.round)
    probe_fastf1(args.year, args.round, args.session)
    print("\nDone. Read the status codes above before changing any ingest code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
