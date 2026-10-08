"""restore missing parent of account passwords

Revision ID: 25124379e97e
Revises: e967c0ec542c
Create Date: 2026-10-08 00:50:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
# `b58a7178c66e` (account passwords) was committed with this revision as its parent, but this file
# never was, so every startup failed. This no-op stands in for it, linking the passwords migration
# to the previous head without editing a migration already on `main`.
revision: str = '25124379e97e'
down_revision: Union[str, Sequence[str], None] = 'e967c0ec542c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
