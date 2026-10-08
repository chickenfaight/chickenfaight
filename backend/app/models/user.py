import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, func, text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # `sub` is the unique, stable identifier for a Google account; null for password-only accounts.
    google_sub: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=True,
    )
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Permanent unique identifier, set once (see app/services/tags.py).
    tag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Changeable display name; not unique (see app/services/usernames.py).
    username: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_salt: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    elo: Mapped[int] = mapped_column(default=0, server_default=text("0"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


# Tags are unique regardless of case, so "Ryan" blocks "ryan".
Index("uq_users_tag_lower", func.lower(User.tag), unique=True)

# Trigram index for player search: serves `LIKE '%q%'` and the fuzzy `%>` operator.
# Needs the pg_trgm extension, which the migration creates.
Index(
    "ix_users_tag_lower_trgm",
    func.lower(User.tag).label("tag_lower"),
    postgresql_using="gin",
    postgresql_ops={"tag_lower": "gin_trgm_ops"},
)
