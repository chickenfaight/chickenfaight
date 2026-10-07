"""Create model catalog and providers.

Revision ID: a831fd02b917
Revises: c709c313023f
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a831fd02b917"
down_revision = "c709c313023f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "providers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("base_url", sa.String(255), nullable=False),
        sa.Column("adapter", sa.Enum(
            "openai_compatible", name="inference_adapter",
            native_enum=False, create_constraint=True, validate_strings=True,
        ), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_providers")),
        sa.UniqueConstraint("slug", name=op.f("uq_providers_slug")),
    )
    op.create_table(
        "models",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("api_model_id", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("input_cost", sa.Numeric(20, 10), nullable=True),
        sa.Column("output_cost", sa.Numeric(20, 10), nullable=True),
        sa.Column("cached_input_cost", sa.Numeric(20, 10), nullable=True),
        sa.Column("pricing_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("context_window", sa.Integer(), nullable=True),
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("provider_metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_models")),
        sa.ForeignKeyConstraint(["provider_id"], ["providers.id"], name=op.f("fk_models_provider_id_providers")),
        sa.UniqueConstraint("provider_id", "api_model_id", name="uq_models_provider_id_api_model_id"),
        sa.CheckConstraint("input_cost >= 0", name=op.f("ck_models_input_cost_nonnegative")),
        sa.CheckConstraint("output_cost >= 0", name=op.f("ck_models_output_cost_nonnegative")),
        sa.CheckConstraint("cached_input_cost >= 0", name=op.f("ck_models_cached_input_cost_nonnegative")),
        sa.CheckConstraint("context_window > 0", name=op.f("ck_models_context_window_positive")),
        sa.CheckConstraint("max_output_tokens > 0", name=op.f("ck_models_max_output_tokens_positive")),
    )
    op.create_index("ix_models_provider_id", "models", ["provider_id"])


def downgrade() -> None:
    op.drop_index("ix_models_provider_id", table_name="models")
    op.drop_table("models")
    op.drop_table("providers")
