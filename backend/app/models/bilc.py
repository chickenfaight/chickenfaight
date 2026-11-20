import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BilcDevice(Base):
    """A paired BILC. Only hashes of its refresh tokens are stored; revoking clears them for good."""
    __tablename__ = "bilc_devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(32))
    client_version: Mapped[str] = mapped_column(String(32))
    # `HELLO.model` from PROTOCOL.md once the device has connected; capped at 4 KB.
    model_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # SHA-256 hex of the current refresh token. Null once revoked.
    refresh_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The current refresh token stops working after this; each rotation moves it forward.
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class BilcSpentRefreshToken(Base):
    """A consumed refresh token's hash, recognized as reuse until its original expiry."""
    __tablename__ = "bilc_spent_refresh_tokens"
    __table_args__ = (Index("ix_bilc_spent_refresh_tokens_device_expiry", "device_id", "expires_at"),)

    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bilc_devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BilcPairingCode(Base):
    """A single-use code from the web app that `bilc pair` exchanges for a device; only its hash is stored."""
    __tablename__ = "bilc_pairing_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
