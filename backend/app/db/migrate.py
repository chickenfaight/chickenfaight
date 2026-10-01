"""Bring a database to the latest migration. Runs on server startup.

CLI: `uv run python -m app.db.migrate` (migrate) or `... --reset` (wipe the
local database first; development only). See "Changing the schema" in BACKEND.md.
"""

import argparse
import logging
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, MetaData, create_engine, inspect, pool

import app.models  # noqa: F401 - registers models with Base.metadata
from app.db.base import Base


logger = logging.getLogger(__name__)
PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"
RESET_COMMAND = "uv run python -m app.db.migrate --reset"


class UnrecoverableDatabaseError(RuntimeError):
    pass


def alembic_config(connection: Connection | None = None) -> Config:
    config = Config(toml_file=str(PYPROJECT))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def find_unrecoverable_state(connection: Connection, script: ScriptDirectory) -> str | None:
    """Describe a database state that migrations can't fix, or None."""
    applied = MigrationContext.configure(connection).get_current_heads()
    known = {revision.revision for revision in script.walk_revisions()}
    unknown = [revision for revision in applied if revision not in known]
    if unknown:
        return (
            f"The database is at migration {', '.join(unknown)}, which this checkout doesn't have "
            "(it was applied on another branch)."
        )
    if not applied and set(inspect(connection).get_table_names()) - {"alembic_version"}:
        return "The database has tables that weren't created by migrations (it predates Alembic)."
    return None


def drop_all_tables(connection: Connection) -> None:
    existing = MetaData()
    existing.reflect(connection)
    existing.drop_all(connection)


def migrate(database_url: str, *, allow_reset: bool) -> None:
    """Upgrade to every head in one transaction; reset first if allowed and needed."""
    script = ScriptDirectory.from_config(alembic_config())
    engine = create_engine(database_url, poolclass=pool.NullPool)
    try:
        with engine.begin() as connection:
            problem = find_unrecoverable_state(connection, script)
            if problem and not allow_reset:
                raise UnrecoverableDatabaseError(
                    f"{problem} Reset your local database with: {RESET_COMMAND}"
                )
            if problem:
                logger.warning("%s Resetting the local database (APP_ENV=development).", problem)
                drop_all_tables(connection)

            command.upgrade(alembic_config(connection), "heads")

            if len(script.get_heads()) > 1:
                logger.warning(
                    "Migrations from different branches haven't been merged. Run "
                    "`uv run alembic merge heads -m merge` and commit the result."
                )
            drift = compare_metadata(MigrationContext.configure(connection), Base.metadata)
            if drift:
                logger.warning(
                    "Models don't match the migrations (%s). Run "
                    "`uv run alembic revision --autogenerate -m \"<change>\"`, review it, and commit it.",
                    "; ".join(str(change) for change in drift),
                )
    finally:
        engine.dispose()


def reset(database_url: str) -> None:
    engine = create_engine(database_url, poolclass=pool.NullPool)
    try:
        with engine.begin() as connection:
            drop_all_tables(connection)
    finally:
        engine.dispose()


def main() -> None:
    from app.config import settings

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--reset", action="store_true", help="drop all tables first (development only)")
    if parser.parse_args().reset:
        if settings.app_env != "development":
            raise SystemExit("Refusing to reset: APP_ENV is not 'development'.")
        reset(settings.database_url)
    migrate(settings.database_url, allow_reset=False)
    print("Database is up to date.")


if __name__ == "__main__":
    main()
