from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas.schemas import QueueRequest
from app.services.arena import ArenaService
from app.services.matchmaking import Matchmaker
from app.services.user import require_username

router = APIRouter(prefix="/match", tags=["match"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.post("/queue", status_code=status.HTTP_202_ACCEPTED)
async def queue_match(
    body: QueueRequest,
    request: Request,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> dict[str, str]:
    """Registers user to the matchmaking queue."""
    require_username(user)
    await ArenaService(session).require_active(body.model_id)
    matchmaker: Matchmaker = request.app.state.matchmaker
    matchmaker.register(user.id, body.model_id)

    return matchmaker.get_status(user.id)

@router.delete("/queue", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_queue(request: Request, user: CurrentUserDependency) -> Response:
    """Removes user from the queue."""
    request.app.state.matchmaker.cancel(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get("/status", status_code=status.HTTP_200_OK)
async def queue_status(request: Request, user: CurrentUserDependency):
    """Gets user queued status."""
    return request.app.state.matchmaker.get_status(user.id)
