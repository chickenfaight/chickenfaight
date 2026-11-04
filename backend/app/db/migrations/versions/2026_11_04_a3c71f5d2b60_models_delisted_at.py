"""models delisted_at

Revision ID: a3c71f5d2b60
Revises: 6d2f8a1c9e47
Create Date: 2026-11-04 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c71f5d2b60'
down_revision: Union[str, Sequence[str], None] = '6d2f8a1c9e47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('models', sa.Column('delisted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('models', 'delisted_at')
