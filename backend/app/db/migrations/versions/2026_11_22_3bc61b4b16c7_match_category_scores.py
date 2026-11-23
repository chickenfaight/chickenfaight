"""Store both sides' scores for each judge category."""

from alembic import op
import sqlalchemy as sa

revision = "3bc61b4b16c7"
down_revision = "bdb29d5a91b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "match_category_scores",
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "argument_quality", "support_for_claims",
                "weighing_and_persuasiveness", "clarity_and_structure",
                name=op.f("ck_match_category_scores_score_category"), native_enum=False, create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("pro_score", sa.Integer(), nullable=False),
        sa.Column("con_score", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("pro_score BETWEEN 0 AND 5", name=op.f("ck_match_category_scores_pro_score_range")),
        sa.CheckConstraint("con_score BETWEEN 0 AND 5", name=op.f("ck_match_category_scores_con_score_range")),
        sa.ForeignKeyConstraint(
            ["match_id"], ["matches.id"],
            name=op.f("fk_match_category_scores_match_id_matches"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("match_id", "category", name=op.f("pk_match_category_scores")),
    )


def downgrade() -> None:
    op.drop_table("match_category_scores")
