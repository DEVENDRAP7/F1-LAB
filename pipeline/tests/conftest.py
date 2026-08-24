import sys
from pathlib import Path

# Pipeline modules use flat imports (`from common import ...`) rather than
# a package layout, matching how they're invoked in CI (`python ingest.py`
# with cwd=pipeline/). Tests run from the repo root via pytest, so put
# pipeline/ on sys.path here instead of duplicating that assumption in
# every test file.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
