from typing import Annotated

from fastapi import APIRouter, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas.schemas import ArenaRead
from app.services.arena import ArenaService

router = APIRouter(prefix="/arenas", tags=["arenas"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("", status_code=status.HTTP_200_OK, response_model=list[ArenaRead])
async def get_arenas(current_user: CurrentUserDependency, session: SessionDependency) -> list[ArenaRead]:
    return await ArenaService(session).list_active()