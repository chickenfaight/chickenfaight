"""Migration safety nets. Each test leaves the test database at the latest migration."""

import logging
from collections.abc import Iterator
from uuid import uuid4

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Column, Engine, Integer, Table, create_engine, inspect, pool, text

from app.db.base import Base
from app.db.migrate import UnrecoverableDatabaseError, alembic_config, migrate, reset

HEADS = set(ScriptDirectory.from_config(alembic_config()).get_heads())


@pytest.fixture
def engine(test_database_url: str) -> Iterator[Engine]:
    reset(test_database_url)
    migrate(test_database_url, allow_reset=False)
    engine = create_engine(test_database_url, poolclass=pool.NullPool)
    yield engine
    engine.dispose()
    migrate(test_database_url, allow_reset=True)


def applied(engine: Engine) -> set[str]:
    with engine.connect() as connection:
        return set(MigrationContext.configure(connection).get_current_heads())


def execute(engine: Engine, sql: str) -> None:
    with engine.begin() as connection:
        connection.execute(text(sql))


def test_models_match_migrations(engine):
    with engine.connect() as connection:
        drift = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert drift == [], (
        "Models changed without a migration. Run "
        "`uv run alembic revision --autogenerate -m \"<change>\"`, review it, and commit it."
    )


def test_every_migration_downgrades_and_upgrades(engine):
    with engine.begin() as connection:
        config = alembic_config(connection)
        command.downgrade(config, "base")
        assert inspect(connection).get_table_names() == ["alembic_version"]
        command.upgrade(config, "heads")
    assert applied(engine) == HEADS


def test_one_way_friends_become_requests_and_mutual_ones_stay_friends(engine):
    ids = {name: str(uuid4()) for name in ("mutual_a", "mutual_b", "adder", "added")}
    with engine.begin() as connection:
        config = alembic_config(connection)
        command.downgrade(config, "dfd89642550f")
        for name, user_id in ids.items():
            connection.execute(text("INSERT INTO users (id, google_sub) VALUES (:id, :sub)"), {"id": user_id, "sub": name})
        rows = [("mutual_a", "mutual_b"), ("mutual_b", "mutual_a"), ("adder", "added")]
        for user, friend in rows:
            connection.execute(text("INSERT INTO friendships (user_id, friend_id) VALUES (:u, :f)"), {"u": ids[user], "f": ids[friend]})

        command.upgrade(config, "heads")
        friendships = connection.execute(text("SELECT user_id::text, friend_id::text FROM friendships")).all()
        assert {tuple(row) for row in friendships} == {(ids["mutual_a"], ids["mutual_b"]), (ids["mutual_b"], ids["mutual_a"])}
        requests = connection.execute(text("SELECT sender_id::text, receiver_id::text FROM friend_requests")).all()
        assert [tuple(row) for row in requests] == [(ids["adder"], ids["added"])]

        # Going back restores every row.
        command.downgrade(config, "dfd89642550f")
        restored = connection.execute(text("SELECT user_id::text, friend_id::text FROM friendships")).all()
        assert {tuple(row) for row in restored} == {(ids[user], ids[friend]) for user, friend in rows}
        command.upgrade(config, "heads")


def test_migrating_a_current_database_keeps_data(engine, test_database_url):
    execute(engine, "INSERT INTO users (id, google_sub) VALUES (gen_random_uuid(), 'keep-me')")
    migrate(test_database_url, allow_reset=True)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM users WHERE google_sub = 'keep-me'")) == 1


@pytest.mark.parametrize(
    "break_database",
    [
        pytest.param("DROP TABLE alembic_version", id="predates-alembic"),
        pytest.param("UPDATE alembic_version SET version_num = 'from_other_branch'", id="unknown-revision"),
    ],
)
def test_unrecoverable_database(engine, test_database_url, break_database, caplog):
    execute(engine, break_database)

    with pytest.raises(UnrecoverableDatabaseError, match="app.db.migrate --reset"):
        migrate(test_database_url, allow_reset=False)

    with caplog.at_level(logging.WARNING, logger="app.db.migrate"):
        migrate(test_database_url, allow_reset=True)
    assert "Resetting the local database" in caplog.text
    assert applied(engine) == HEADS


def test_startup_warns_when_models_drift(engine, test_database_url, caplog):
    probe = Table("drift_probe", Base.metadata, Column("id", Integer, primary_key=True))
    try:
        with caplog.at_level(logging.WARNING, logger="app.db.migrate"):
            migrate(test_database_url, allow_reset=False)
    finally:
        Base.metadata.remove(probe)
    assert "alembic revision --autogenerate" in caplog.text
    assert "drift_probe" in caplog.text
