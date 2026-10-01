from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketException

from app.auth.dependencies import WebSocketUserIdDependency
from app.engine.game_engine import GameEngine
from app.services.matchmaking import Matchmaker

router = APIRouter(prefix="/game", tags=["game"])


@router.websocket("/{match_id}/ws")
async def connect_game(
    websocket: WebSocket,
    match_id: UUID,
    user_id: WebSocketUserIdDependency,
) -> None:
    """Opens a WebSocket connection for the game."""
    matchmaker: Matchmaker = websocket.app.state.matchmaker

    if matchmaker.assignments.get(user_id) != match_id:
        raise WebSocketException(
            code=4403,
            reason="Not assigned to this match",
        )

    engine = matchmaker.engines.get(match_id)
    if engine is None:
        raise WebSocketException(
            code=4403,
            reason="Match is no longer active",
        )

    await websocket.accept()
    await engine.handle_connection(user_id, websocket)
