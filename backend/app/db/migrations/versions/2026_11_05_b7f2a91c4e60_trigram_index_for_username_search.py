"""trigram index for username search

Revision ID: b7f2a91c4e60
Revises: 7d8324088403
Create Date: 2026-11-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7f2a91c4e60'
down_revision: Union[str, Sequence[str], None] = '7d8324088403'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
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
