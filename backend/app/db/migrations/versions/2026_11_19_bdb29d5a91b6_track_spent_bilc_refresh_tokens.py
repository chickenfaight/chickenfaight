"""Track spent BILC refresh tokens."""

from alembic import op
import sqlalchemy as sa

revision = "bdb29d5a91b6"
down_revision = "b7f2a91c4e60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bilc_spent_refresh_tokens",
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["device_id"], ["bilc_devices.id"],
            name=op.f("fk_bilc_spent_refresh_tokens_device_id_bilc_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("device_id", "token_hash", name=op.f("pk_bilc_spent_refresh_tokens")),
    )
    op.create_index(
        "ix_bilc_spent_refresh_tokens_device_expiry",
        "bilc_spent_refresh_tokens",
        ["device_id", "expires_at"],
    )
    # The previous token's original expiry was overwritten. Preserve detection through
    # the current token's expiry, when the device would have to pair again anyway.
    op.execute(sa.text("""
        INSERT INTO bilc_spent_refresh_tokens (device_id, token_hash, expires_at)
        SELECT id, previous_refresh_token_hash, refresh_token_expires_at
        FROM bilc_devices
        WHERE previous_refresh_token_hash IS NOT NULL
          AND refresh_token_expires_at IS NOT NULL
          AND revoked_at IS NULL
    """))
    op.drop_column("bilc_devices", "previous_refresh_token_hash")


def downgrade() -> None:
    op.add_column("bilc_devices", sa.Column("previous_refresh_token_hash", sa.String(64), nullable=True))
    # The earlier schema only has room for one spent hash per device.
    op.execute(sa.text("""
        UPDATE bilc_devices AS device
        SET previous_refresh_token_hash = (
            SELECT token_hash
            FROM bilc_spent_refresh_tokens
            WHERE device_id = device.id
            ORDER BY expires_at DESC, token_hash
            LIMIT 1
        )
    """))
    op.drop_table("bilc_spent_refresh_tokens")
