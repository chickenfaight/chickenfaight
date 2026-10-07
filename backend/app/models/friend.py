import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Friendship(Base):
    """`user_id` added `friend_id` as a friend. One-way: the other player doesn't approve it."""
    __tablename__ = "friendships"
    __table_args__ = (CheckConstraint("user_id <> friend_id", name="not_self"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # The primary key's index covers `user_id`; this one serves lookups and cascades by friend.
    friend_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
