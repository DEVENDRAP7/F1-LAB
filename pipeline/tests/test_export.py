import pytest

from common import BudgetExceeded, check_file_budget


def test_check_file_budget_passes_under_limit(tmp_path):
    path = tmp_path / "small.json"
    path.write_text("{}")
    check_file_budget(path, max_bytes=1024)  # should not raise


def test_check_file_budget_raises_over_limit(tmp_path):
    path = tmp_path / "big.json"
    path.write_text("x" * 100)
    with pytest.raises(BudgetExceeded):
        check_file_budget(path, max_bytes=10)
