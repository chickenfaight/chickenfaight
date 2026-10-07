import uuid
from datetime import datetime

from sqlalchemy import DateTime, func, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

class Friend(Base):
    __tablename__ = "friends"
    
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    other_id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
