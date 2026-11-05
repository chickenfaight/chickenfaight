from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# About 1,000 topics of typical length; `TopicService` also caps the topic count.
MAX_UPLOAD_CHARS = 200_000


class TopicUpload(BaseModel):
    """A topic list in the importer's format: `category | topic | pro position | con position` per line."""
    text: str = Field(min_length=1, max_length=MAX_UPLOAD_CHARS)
    is_active: bool = True


class TopicUploadResult(BaseModel):
    added: int
    skipped: int


class AdminTopic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: str
    topic: str
    pro_position: str
    con_position: str
    is_active: bool
    created_at: datetime


class AdminTopicsPage(BaseModel):
    total: int
    topics: list[AdminTopic]
