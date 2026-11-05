"""match history details

Revision ID: c4e19b7a2d35
Revises: 5a554947da58
Create Date: 2026-11-05 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e19b7a2d35'
down_revision: Union[str, Sequence[str], None] = '5a554947da58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('match_participants', sa.Column('model_name', sa.String(length=255), nullable=True))
    op.add_column('match_participants', sa.Column('elo_before', sa.Integer(), nullable=True))
    op.add_column('match_participants', sa.Column('elo_after', sa.Integer(), nullable=True))
    # Cloud matches name their model; BYOM ones never recorded theirs, so they stay null.
    op.execute("""
        UPDATE match_participants AS participant
        SET model_name = model.display_name
        FROM matches AS match
        JOIN models AS model ON model.id = match.model_id
        WHERE match.id = participant.match_id
    """)
    op.create_table('turns',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('match_id', sa.Uuid(), nullable=False),
    sa.Column('index', sa.Integer(), nullable=False),
    sa.Column('side', sa.Enum('pro', 'con', name='turn_side', native_enum=False, create_constraint=True), nullable=False),
    sa.Column('phase', sa.Enum('opening', 'rebuttal', 'closing', name='turn_phase', native_enum=False, create_constraint=True), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('truncated', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['match_id'], ['matches.id'], name=op.f('fk_turns_match_id_matches'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_turns')),
    sa.UniqueConstraint('match_id', 'index', name='uq_turns_match_id_index')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('turns')
    op.drop_column('match_participants', 'elo_after')
    op.drop_column('match_participants', 'elo_before')
    op.drop_column('match_participants', 'model_name')
