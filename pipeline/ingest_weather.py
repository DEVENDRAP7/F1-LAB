"""Open-Meteo: a second, independent measurement of race-day conditions.

Why a second source at all
--------------------------
Everything else on this site is internally consistent by construction.
Two sources describing the same event is the only arrangement where the
project can actually be caught being wrong, and until now there was
exactly one such pair: OpenF1's telemetry lap times against Jolpica's
official qualifying results.

This is the second. OpenF1 publishes a weather channel measured at the
circuit. Open-Meteo publishes a reanalysis of the same hours at the same
coordinates, from an entirely different chain of instruments and models,
and knows nothing about motor racing. Where they agree on air
temperature, both are probably right. Where they do not, something is
wrong and the site says so instead of picking one.

The coordinates are not typed in from memory: Jolpica publishes a
latitude and longitude for every circuit, and those are what get asked
about.

Licence and manners
-------------------
Open-Meteo's archive needs no key and is CC BY 4.0, which docs/SOURCES.md
attributes. It is a free service being used for a handful of requests per
refresh, so it gets the same politeness as every other host here.
"""
from __future__ import annotations

import time

import requests

ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive"

# The variables that can be compared against a trackside weather feed.
# Track temperature is deliberately absent: no reanalysis product
# publishes the temperature of a specific piece of tarmac, and asking for
# a proxy would defeat the point of an independent check.
HOURLY_VARIABLES = (
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
)

REQUEST_GAP_S = 0.4
TIMEOUT_S = 30


def fetch_archive(latitude: float, longitude: float, date: str) -> dict:
    """One day of hourly reanalysis at one point.

    UTC throughout, because every timestamp this project handles is UTC
    and a local-time weather series would silently shift a session's
    conditions by the circuit's own offset.
    """
    params = {
        "latitude": f"{float(latitude):.4f}",
        "longitude": f"{float(longitude):.4f}",
        "start_date": date,
        "end_date": date,
        "hourly": ",".join(HOURLY_VARIABLES),
        "timezone": "UTC",
        "wind_speed_unit": "ms",
    }
    time.sleep(REQUEST_GAP_S)
    response = requests.get(ARCHIVE_BASE, params=params, timeout=TIMEOUT_S)
    response.raise_for_status()
    payload = response.json()

    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    return {
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        # The archive snaps to its own grid cell, so how far that cell is
        # from the circuit is part of the measurement and travels with it.
        "elevationM": payload.get("elevation"),
        "hours": [
            {
                "time": times[i],
                "airTemperatureC": _at(hourly, "temperature_2m", i),
                "humidityPct": _at(hourly, "relative_humidity_2m", i),
                "precipitationMm": _at(hourly, "precipitation", i),
                "windSpeedMs": _at(hourly, "wind_speed_10m", i),
            }
            for i in range(len(times))
        ],
    }


def _at(hourly: dict, key: str, index: int):
    values = hourly.get(key) or []
    return values[index] if index < len(values) else None
