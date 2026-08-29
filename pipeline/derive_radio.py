"""The broadcast team radio timeline for a race.

WHAT IS PUBLISHED

Who was on the radio, at what time, on which lap, and a link to the clip
where OpenF1 serves it. Nothing more.

WHAT IS NOT

No audio is copied into this repository. The clips are F1 broadcast
material served from their own host, and this project links to them
rather than rehosting them — which is both the right thing to do with
someone else's recording and the only thing the site's payload budget
would allow.

No transcripts. Nothing here converts speech to text. A transcript this
project generated would be a paraphrase presented as a quotation, and
"the model heard him say" is not a source. If a reader wants to know what
was said, the link plays the original.

No sentiment, no tone, no inference about a driver's state of mind. The
timeline says a radio message exists and when; it does not say what kind
of message it was.

HOW COMPLETE IT IS

Not complete at all, and the shape of the gap matters. OpenF1 states
that only a limited selection of communications is included. A driver
with two clips is a driver the broadcast selected twice; the count is a
measure of television, not of a team's radio traffic. Every figure here
is labelled as broadcast selections for that reason.
"""
from __future__ import annotations

# Below this a race has a handful of stray clips rather than a timeline.
MIN_CLIPS = 5


def _parse(iso: str | None):
    if not iso:
        return None
    text = iso.replace("Z", "+00:00")
    try:
        import datetime
        return datetime.datetime.fromisoformat(text)
    except ValueError:
        return None


def lap_at(moment, lap_starts: list[tuple[int, object]]):
    """Which lap a moment fell in, from lap start times.

    `lap_starts` is (lap number, start datetime) in order. A clip before
    the first recorded lap start belongs to no lap rather than to lap 1:
    the formation lap and the grid are radio-heavy and are not racing.
    """
    if moment is None:
        return None
    found = None
    for number, start in lap_starts:
        if start is None or start > moment:
            break
        found = number
    return found


def build_timeline(clips: list[dict], lap_starts: list[tuple[int, object]],
                   codes_by_number: dict[int, str]) -> list[dict]:
    out = []
    for clip in clips:
        moment = _parse(clip.get("date"))
        number = clip.get("driverNumber")
        out.append({
            "date": clip.get("date"),
            "driverNumber": number,
            "driverCode": codes_by_number.get(number),
            "lap": lap_at(moment, lap_starts),
            "recordingUrl": clip.get("recordingUrl"),
        })
    out.sort(key=lambda c: (c["date"] or ""))
    return out


def count_by_driver(timeline: list[dict]) -> list[dict]:
    counts: dict[int, dict] = {}
    for clip in timeline:
        number = clip.get("driverNumber")
        if number is None:
            continue
        row = counts.setdefault(number, {
            "driverNumber": number,
            "driverCode": clip.get("driverCode"),
            "clips": 0,
        })
        row["clips"] += 1
        row["driverCode"] = row["driverCode"] or clip.get("driverCode")
    return sorted(counts.values(), key=lambda r: (-r["clips"], r["driverNumber"]))


def assess(clips: list[dict], lap_starts: list[tuple[int, object]],
           codes_by_number: dict[int, str], min_clips: int = MIN_CLIPS) -> dict:
    if len(clips) < min_clips:
        return {
            "published": False,
            "clips": len(clips),
            "withheldReason": (
                f"the broadcast radio feed carried {len(clips)} clip(s) for this race, "
                f"below the {min_clips} that makes a timeline rather than a handful of "
                "stray messages. Team radio is released by the broadcast rather than by "
                "the teams, and coverage of it fell away sharply this season"
            ),
        }

    timeline = build_timeline(clips, lap_starts, codes_by_number)
    return {
        "published": True,
        "clips": len(timeline),
        "timeline": timeline,
        "byDriver": count_by_driver(timeline),
        "withLap": sum(1 for c in timeline if c["lap"] is not None),
    }


LIMITATIONS = [
    "These are broadcast selections, not a team's radio traffic. Only a "
    "limited selection of communications is released, so a driver with "
    "more clips than another is a driver the broadcast chose more often "
    "— the count measures television, not radio.",
    "Nothing is transcribed. No text version of any clip is generated "
    "here, because a transcript this project produced would be a "
    "paraphrase presented as a quotation. The link plays the original.",
    "No audio is copied into this site. Every clip is linked where its "
    "publisher serves it.",
    "Nothing is inferred from a clip: not its tone, not its subject, not "
    "what it says about a driver's race. The timeline records that a "
    "message exists and when.",
    "A clip before the first recorded lap start is given no lap number "
    "rather than lap 1. The grid and the formation lap carry a lot of "
    "radio and are not racing.",
]


def build(year: int, races: list[dict], generated_at: str, source: str) -> dict:
    published = [r for r in races if r["radio"]["published"]]
    return {
        "year": year,
        "generated_at": generated_at,
        "source": source,
        "races": races,
        "publishedCount": len(published),
        "withheldCount": len(races) - len(published),
        "limitations": LIMITATIONS,
    }
