import pytest
from database_safety import require_test_database


@pytest.mark.parametrize("test_url,application_url", [
    ("postgresql://localhost/live", "postgresql://localhost/app"),
    ("sqlite:///app_test", "postgresql://localhost/app"),
    ("postgresql://a:secret@localhost/app_test", "postgresql+psycopg://b:other@localhost:5432/app_test"),
])
def test_database_guard_rejects_unsafe_targets(test_url, application_url):
    with pytest.raises(ValueError):
        require_test_database(test_url, application_url)


def test_database_guard_accepts_separate_test_database():
    target = "postgresql://localhost/chickenfaight_test"
    assert require_test_database(target, "postgresql://localhost/chickenfaight") == target
