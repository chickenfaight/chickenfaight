import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, func, text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

class Friend(base):
    __tablename__ = "friends"
    
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    other_id: Mapped[uuid.UUID] = mapped_column(Uuid, default=uuid.uuid4)