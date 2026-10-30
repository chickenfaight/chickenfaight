import uuid
from datetime import datetime

from sqlalchemy import DateTime, func, Uuid, String, JSON, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

class Ladder(Base):
    __tablename__ = "ladders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(50))  # 'cloud' or 'byom'
    provider_model_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    provider_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

class Rating(Base):
    __tablename__ = "ratings"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    ladder_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)

    elo: Mapped[int] = mapped_column(default=1000, server_default=text("1000"))
    games_played: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    wins: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    losses: Mapped[int] = mapped_column(default=0, server_default=text("0"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
