from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.models.user import User
from app.schemas.schemas import QueueRequest
from app.services.arena import BYOM_ARENA_ID, ArenaService
from app.services.bilc import BilcService
from app.services.bilc_connections import BilcConnections
from app.services.matchmaking import Matchmaker
from app.services.challenge import today
from app.services.exceptions import (
    BilcBusyError,
    BilcOfflineError,
    ByomQueueInvalidError,
    ChallengeAlreadyCompletedError,
)
from app.services.rewards import completed_challenge
from app.services.user import require_tag

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
    require_tag(user)
    matchmaker: Matchmaker = request.app.state.matchmaker
    if body.model_id == BYOM_ARENA_ID:
        await queue_byom(body, request, user, session)
        return matchmaker.get_status(user.id)
    if body.bilc_id is not None:
        raise ByomQueueInvalidError("Only the BYOM arena takes a device.")
    await ArenaService(session).require_active(body.model_id)
    challenge_day = None
    if body.daily:
        challenge_day = today()
        if await completed_challenge(session, user.id, challenge_day):
            raise ChallengeAlreadyCompletedError()
    matchmaker.register(user.id, body.model_id, challenge_day)

    return matchmaker.get_status(user.id)


async def queue_byom(body: QueueRequest, request: Request, user: User, session: AsyncSession) -> None:
    """The BYOM arena needs one of the caller's own devices, connected and not already playing."""
    if body.daily:
        raise ByomQueueInvalidError("The daily challenge isn't played in the BYOM arena.")
    if body.bilc_id is None:
        raise ByomQueueInvalidError("Choose one of your BILC devices to play with.")
    device = await BilcService(session).get_owned(user, body.bilc_id)
    bilc: BilcConnections = request.app.state.bilc_connections
    match bilc.status(device.id):
        case "offline":
            raise BilcOfflineError()
        case "busy":
            raise BilcBusyError()
    size_class = bilc.size_class(device.id)
    if size_class is None:  # disconnected since the status check
        raise BilcOfflineError()
    request.app.state.matchmaker.register_byom(user.id, device.id, size_class)

@router.delete("/queue", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_queue(request: Request, user: CurrentUserDependency) -> Response:
    """Removes user from the queue."""
    request.app.state.matchmaker.cancel(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get("/status", status_code=status.HTTP_200_OK)
async def queue_status(request: Request, user: CurrentUserDependency):
    """Gets user queued status."""
    return request.app.state.matchmaker.get_status(user.id)
