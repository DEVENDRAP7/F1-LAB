"""Pin OpenF1's range-filter encoding.

This is regression cover for a silent, expensive bug. OpenF1 spells a
range filter with the operator as a literal character (`date>2026-...`).
Passed through requests' `params`, the `>` percent-encodes to `%3E` and
the `+00:00` offset to `%2B00:00`, and the API then ignores the filter
and returns the whole session — answering 200 with entirely plausible
rows. A "one lap" fetch silently becomes a whole race, and a racing line
built from it is the race's entire path rather than one lap.

It cost a 30-minute pipeline run before it was spotted.
"""
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ingest_openf1 import _range_filter  # noqa: E402


def test_operator_survives_as_a_literal_character():
    f = _range_filter("date", ">", "2026-08-23T13:00:00+00:00")
    assert f.startswith("date>")
    assert "%3E" not in f


def test_utc_offset_is_stripped_rather_than_encoded():
    """'+00:00' would encode to '%2B00:00' and break the comparison."""
    assert _range_filter("date", "<", "2026-08-23T13:00:00+00:00") == \
        "date<2026-08-23T13:00:00"
    assert _range_filter("date", "<", "2026-08-23T13:00:00Z") == \
        "date<2026-08-23T13:00:00"


def test_params_encoding_would_have_broken_it():
    """The exact behaviour this module has to route around, pinned so the
    reason the raw-filter path exists stays visible."""
    prepared = requests.Request(
        "GET", "https://api.openf1.org/v1/location",
        params={"date>": "2026-08-23T13:00:00+00:00"},
    ).prepare()
    assert "date%3E=" in prepared.url
    assert "date>" not in prepared.url


def test_prepared_request_override_keeps_the_operator_literal():
    """The second half of the bug: building the query string by hand is
    not enough, because PreparedRequest runs the URL through requote_uri
    and re-encodes '>' anyway. Assigning .url after prepare() is the only
    point past that, and this pins it — a 30-minute pipeline run was lost
    to the difference."""
    literal = ("https://api.openf1.org/v1/location"
               "?session_key=1&driver_number=4&date>2026-08-23T13:00:00")

    naive = requests.Request("GET", literal).prepare()
    assert "date>" not in naive.url          # requote_uri got it
    assert "date%3E" in naive.url

    overridden = requests.Request("GET", "https://api.openf1.org/v1/location").prepare()
    overridden.url = literal
    assert "date>" in overridden.url         # survives
