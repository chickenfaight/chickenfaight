"""merge friends and model catalog

Revision ID: 49c056669aa9
Revises: 8c41d2e7a9b3, a831fd02b917
Create Date: 2026-10-07 21:26:34.042823

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '49c056669aa9'
down_revision: Union[str, Sequence[str], None] = ('8c41d2e7a9b3', 'a831fd02b917')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
