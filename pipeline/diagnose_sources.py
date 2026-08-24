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


def probe_http(year: int) -> None:
    print(f"\n=== Raw HTTP probes ===")

    print("\nJolpica-F1 (the source that currently works):")
    probe(f"{JOLPICA_BASE}/{year}.json")

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--session", type=str, default="Q")
    args = parser.parse_args()

    probe_http(args.year)
    probe_fastf1(args.year, args.round, args.session)
    print("\nDone. Read the status codes above before changing any ingest code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
