import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Friendship(Base):
    """`user_id` and `friend_id` are friends: both agreed. A friendship is stored as two rows, one
    each way, so listing and checking a player's friends needs only `user_id`."""
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


class FriendRequest(Base):
    """`sender_id` asked to be friends with `receiver_id`, who hasn't answered yet. Answering deletes
    it. At most one exists per pair: requesting someone who already asked you makes you friends."""
    __tablename__ = "friend_requests"
    __table_args__ = (CheckConstraint("sender_id <> receiver_id", name="not_self"),)

    sender_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # The primary key's index covers `sender_id`; this one serves incoming requests and cascades.
    receiver_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
