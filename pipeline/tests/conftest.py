import sys
from pathlib import Path

import pytest

# Pipeline modules use flat imports (`from common import ...`) rather than
# a package layout, matching how they're invoked in CI (`python ingest.py`
# with cwd=pipeline/). Tests run from the repo root via pytest, so put
# pipeline/ on sys.path here instead of duplicating that assumption in
# every test file.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# The suite must never write into the repository's own published data.
#
# It did, for a while, and nothing noticed: a test redirected
# run_refresh.PUBLIC_DATA to a tmp_path but export.py holds its own
# reference, so on CI — where the network works — the export ran for real
# and wrote round 1 into public/data with the test fixture's race name.
# "X" was committed as the Australian Grand Prix on every refresh, and the
# suite passed each time.
#
# This snapshot makes that failure loud instead of silent. It compares the
# published tree before and after the whole session: a test that means to
# write must write under tmp_path.
@pytest.fixture(scope="session", autouse=True)
def public_data_is_read_only():
    from common import PUBLIC_DATA

    def snapshot():
        if not PUBLIC_DATA.exists():
            return {}
        return {
            path: path.stat().st_mtime_ns
            for path in PUBLIC_DATA.rglob("*")
            if path.is_file()
        }

    before = snapshot()
    yield
    after = snapshot()

    touched = sorted(
        str(path.relative_to(PUBLIC_DATA))
        for path in set(before) | set(after)
        if before.get(path) != after.get(path)
    )
    assert not touched, (
        "the test suite wrote into the repository's published data: "
        + ", ".join(touched)
        + " — redirect every module's PUBLIC_DATA (export.py keeps its own) "
        "and write under tmp_path instead"
    )
