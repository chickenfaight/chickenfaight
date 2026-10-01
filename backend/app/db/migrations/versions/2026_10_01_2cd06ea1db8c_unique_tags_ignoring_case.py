"""unique tags ignoring case

Revision ID: 2cd06ea1db8c
Revises: 9f5b88d8ada3
Create Date: 2026-10-01 01:28:50.404680

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2cd06ea1db8c'
down_revision: Union[str, Sequence[str], None] = '9f5b88d8ada3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index('uq_users_username_lower', 'users', [sa.literal_column('lower(username)')], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_users_username_lower', table_name='users')
