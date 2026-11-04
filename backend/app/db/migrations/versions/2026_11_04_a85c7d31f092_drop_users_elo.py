"""Drop users.elo.

Revision ID: a85c7d31f092
Revises: 6d2f8a1c9e47
"""

from alembic import op
import sqlalchemy as sa

revision = "a85c7d31f092"
down_revision = "6d2f8a1c9e47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("users", "elo")


def downgrade() -> None:
    op.add_column("users", sa.Column("elo", sa.Integer(), server_default=sa.text("0"), nullable=False))
