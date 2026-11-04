"""friend requests

Revision ID: 6d2f8a1c9e47
Revises: dfd89642550f
Create Date: 2026-11-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6d2f8a1c9e47'
down_revision: Union[str, Sequence[str], None] = 'dfd89642550f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('friend_requests',
    sa.Column('sender_id', sa.Uuid(), nullable=False),
    sa.Column('receiver_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('sender_id <> receiver_id', name=op.f('ck_friend_requests_not_self')),
    sa.ForeignKeyConstraint(['receiver_id'], ['users.id'], name=op.f('fk_friend_requests_receiver_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], name=op.f('fk_friend_requests_sender_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('sender_id', 'receiver_id', name=op.f('pk_friend_requests'))
    )
    op.create_index(op.f('ix_friend_requests_receiver_id'), 'friend_requests', ['receiver_id'], unique=False)

    # Friends used to be one-way adds. Mutual adds stay friends; a one-way add was never agreed
    # to, so it becomes a request the other player can answer.
    op.execute("""
        INSERT INTO friend_requests (sender_id, receiver_id, created_at)
        SELECT added.user_id, added.friend_id, added.created_at
        FROM friendships AS added
        WHERE NOT EXISTS (
            SELECT 1 FROM friendships AS back
            WHERE back.user_id = added.friend_id AND back.friend_id = added.user_id
        )
    """)
    op.execute("""
        DELETE FROM friendships AS added
        WHERE NOT EXISTS (
            SELECT 1 FROM friendships AS back
            WHERE back.user_id = added.friend_id AND back.friend_id = added.user_id
        )
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("""
        INSERT INTO friendships (user_id, friend_id, created_at)
        SELECT sender_id, receiver_id, created_at FROM friend_requests
        ON CONFLICT DO NOTHING
    """)
    op.drop_index(op.f('ix_friend_requests_receiver_id'), table_name='friend_requests')
    op.drop_table('friend_requests')
