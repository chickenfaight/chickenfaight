from alembic.script import ScriptDirectory

from app.db.migrate import alembic_config


def test_migrations_have_a_single_head():
    heads = ScriptDirectory.from_config(alembic_config()).get_heads()
    assert len(heads) == 1, (
        f"Unmerged migration branches {heads}. Run `uv run alembic merge heads -m merge` "
        "and commit the generated file (see BACKEND.md, 'Changing the schema')."
    )
