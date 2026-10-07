"""replace friends with friendships

Revision ID: 8c41d2e7a9b3
Revises: a564d201ffb5
Create Date: 2026-10-07 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8c41d2e7a9b3'
down_revision: Union[str, Sequence[str], None] = 'a564d201ffb5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # `friends` keyed rows on the adder's ID, allowing one friend per user, and had no
    # foreign keys. Its rows can't be trusted to reference real users, so they aren't copied.
    op.drop_table('friends')
    op.create_table('friendships',
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('friend_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('user_id <> friend_id', name=op.f('ck_friendships_not_self')),
    sa.ForeignKeyConstraint(['friend_id'], ['users.id'], name=op.f('fk_friendships_friend_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_friendships_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'friend_id', name=op.f('pk_friendships'))
    )
    op.create_index(op.f('ix_friendships_friend_id'), 'friendships', ['friend_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_friendships_friend_id'), table_name='friendships')
    op.drop_table('friendships')
    op.create_table('friends',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('other_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_friends'))
    )
