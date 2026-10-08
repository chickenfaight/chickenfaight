"""merge

Revision ID: e967c0ec542c
Revises: 235b99c873a8, 49c056669aa9
Create Date: 2026-10-07 23:15:20.604634

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e967c0ec542c'
down_revision: Union[str, Sequence[str], None] = ('235b99c873a8', '49c056669aa9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
