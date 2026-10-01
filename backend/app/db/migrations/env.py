"""Alembic environment. Runs migrations synchronously (psycopg supports both modes).

Used by the CLI (`uv run alembic ...`) and by `app.db.migrate`, which passes
an open connection through `config.attributes["connection"]`.
"""

import logging

from alembic import context
from sqlalchemy import Connection, create_engine, pool

import app.models  # noqa: F401 - registers models with Base.metadata
from app.config import settings
from app.db.base import Base


def run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) mode is not supported; run against a database.")

shared_connection = context.config.attributes.get("connection")
if shared_connection is not None:
    run_migrations(shared_connection)
else:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    engine = create_engine(settings.database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        run_migrations(connection)
