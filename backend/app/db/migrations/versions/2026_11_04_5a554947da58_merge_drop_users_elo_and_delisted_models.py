"""merge drop users elo and delisted models

Revision ID: 5a554947da58
Revises: a3c71f5d2b60, a85c7d31f092
Create Date: 2026-11-04 16:18:45.468679

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a554947da58'
down_revision: Union[str, Sequence[str], None] = ('a3c71f5d2b60', 'a85c7d31f092')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
