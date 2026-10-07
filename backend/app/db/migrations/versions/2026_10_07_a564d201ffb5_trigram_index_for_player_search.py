"""trigram index for player search

Revision ID: a564d201ffb5
Revises: 2fe41f402ed3
Create Date: 2026-10-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a564d201ffb5'
down_revision: Union[str, Sequence[str], None] = '2fe41f402ed3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # pg_trgm is a trusted extension (Postgres 13+), so the database owner can create it.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        'ix_users_username_lower_trgm',
        'users',
        [sa.literal_column('lower(username)').label('username_lower')],
        unique=False,
        postgresql_using='gin',
        postgresql_ops={'username_lower': 'gin_trgm_ops'},
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_users_username_lower_trgm', table_name='users')
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
