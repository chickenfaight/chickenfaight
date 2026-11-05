from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AdminUserDependency
from app.db.session import get_session
from app.schemas import AdminTopicsPage, TopicUpload, TopicUploadResult
from app.services.topics import TopicService

# Every route here takes `AdminUserDependency`: 401 without a session, 403 `FORBIDDEN` for non-admins.
router = APIRouter(prefix="/admin", tags=["admin"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("/topics", response_model=AdminTopicsPage)
async def list_topics(admin: AdminUserDependency, session: SessionDependency) -> AdminTopicsPage:
    """The newest topics, active or not, and how many exist."""
    return await TopicService(session).recent()


@router.post("/topics", response_model=TopicUploadResult)
async def upload_topics(
    data: TopicUpload, admin: AdminUserDependency, session: SessionDependency
) -> TopicUploadResult:
    """Validate the whole list, then add new topics in one transaction; identical ones are skipped."""
    return await TopicService(session).upload(data.text, is_active=data.is_active)
