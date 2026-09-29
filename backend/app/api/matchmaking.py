from fastapi import APIRouter, Request, Response, status

from app.auth.dependencies import CurrentUserDependency
from app.services.matchmaking import Matchmaker

router = APIRouter(prefix="/match", tags=["match"])


@router.post("/queue", status_code=status.HTTP_202_ACCEPTED)
async def queue_match(request: Request, user: CurrentUserDependency):
    """
    Registers user to the matchmaking queue.
    """
    matchmaker: Matchmaker = request.app.state.matchmaker
    matchmaker.register(user.id)

    return {"status": "queued"}
