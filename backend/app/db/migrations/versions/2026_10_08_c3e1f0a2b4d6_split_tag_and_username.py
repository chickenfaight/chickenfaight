"""split the permanent tag from a changeable username

Revision ID: c3e1f0a2b4d6
Revises: a705abe5269e
Create Date: 2026-10-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e1f0a2b4d6'
down_revision: Union[str, Sequence[str], None] = 'a705abe5269e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # `users.username` held the permanent tag; rename it (keeping data) and its indexes.
    op.alter_column('users', 'username', new_column_name='tag')
    op.execute('ALTER INDEX uq_users_username_lower RENAME TO uq_users_tag_lower')
    op.execute('ALTER INDEX ix_users_username_lower_trgm RENAME TO ix_users_tag_lower_trgm')
    # The new, changeable display name. Existing users start with their tag.
    op.add_column('users', sa.Column('username', sa.String(length=32), nullable=True))
    op.execute('UPDATE users SET username = tag WHERE tag IS NOT NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'username')
    op.execute('ALTER INDEX ix_users_tag_lower_trgm RENAME TO ix_users_username_lower_trgm')
    op.execute('ALTER INDEX uq_users_tag_lower RENAME TO uq_users_username_lower')
    op.alter_column('users', 'tag', new_column_name='username')
