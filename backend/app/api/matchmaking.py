from fastapi import APIRouter, Request, Response, status

from app.auth.dependencies import CurrentUserDependency
from app.services.matchmaking import Matchmaker
from app.services.user import require_username

router = APIRouter(prefix="/match", tags=["match"])


@router.post("/queue", status_code=status.HTTP_202_ACCEPTED)
async def queue_match(request: Request, user: CurrentUserDependency):
    """
    Registers user to the matchmaking queue.
    """
    require_username(user)
    matchmaker: Matchmaker = request.app.state.matchmaker
    matchmaker.register(user.id)

    return matchmaker.get_status(user.id)

@router.get("/status", status_code=status.HTTP_200_OK)
async def queue_status(request: Request, user: CurrentUserDependency):
    """Gets user queued status"""
    return request.app.state.matchmaker.get_status(user.id)


@router.delete("/queue", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_queue(request: Request, user: CurrentUserDependency) -> Response:
    request.app.state.matchmaker.cancel(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
