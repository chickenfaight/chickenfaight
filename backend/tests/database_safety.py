"""Shared guard for every test utility that wipes a database."""
from sqlalchemy.engine import make_url


def require_test_database(test_url: str, application_url: str) -> str:
    candidate, application = make_url(test_url), make_url(application_url)
    if candidate.get_backend_name() != "postgresql" or not (candidate.database or "").endswith("_test"):
        raise ValueError("Test database must be PostgreSQL and its name must end in _test")
    if (candidate.host, candidate.port or 5432, candidate.database) == (
        application.host, application.port or 5432, application.database
    ):
        raise ValueError("Test database must differ from POSTGRES_URL")
    return test_url
