import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func, text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    category: Mapped[str] = mapped_column(String(255), nullable=False, default="General", server_default="General")
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    pro_position: Mapped[str] = mapped_column(String(255), nullable=False)
    con_position: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default=text("true"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
