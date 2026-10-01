from uuid import UUID

from fastapi import WebSocket, WebSocketDisconnect


class GameEngine:
    def __init__(self, match_id: UUID, players: tuple[UUID, UUID], model: str):
        # TODO figure out LLM identifier strategy
        self.players = players
        self.match_id = match_id
        self.model = model

        self.connections: dict[UUID, WebSocket] = {}

    async def run(self):
        pass # TODO

    async def handle_connection(
            self,
            user_id: UUID,
            websocket: WebSocket
    ) -> None:
        self.connections[user_id] = websocket

        try:
            while True:
                message = await websocket.receive_json()
                await self.handle_message(user_id, message)
        except WebSocketDisconnect:
            pass
        finally:
            if self.connections.get(user_id) is websocket:
                del self.connections[user_id]

    async def handle_message(self, user_id: UUID, message: dict):
        pass # TODO
