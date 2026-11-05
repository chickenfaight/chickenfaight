import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserBlock(Base):
    """`user_id` has blocked `blocked_id`. A blocked user cannot access the blocker's profile,
    but can block back. Blocked users automatically cancel friendships."""
    __tablename__ = "blocks"
    __table_args__ = (CheckConstraint("user_id <> blocked_id", name="not_self"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # The primary key's index covers `user_id`; this one serves lookups by potential blockees.
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

