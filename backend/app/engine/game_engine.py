import asyncio
import random
from typing import Literal
from uuid import UUID

from fastapi import WebSocket
from pydantic import ValidationError

from app.db.session import SessionFactory
from app.models import Topic
from app.repositories.topic import TopicRepository
from app.schemas.schemas import TopicRead, PromptSubmission

Side = Literal["pro", "con"]

class GameEngine:
    def __init__(self, match_id: UUID, players: tuple[UUID, UUID], model: str):
        # TODO figure out LLM identifier strategy
        self.players = players
        self.match_id = match_id
        self.model = model
        self.topic: Topic | None = None

        pro, con = random.sample(players, k=2)
        self.sides: dict[UUID, Side] = {
            pro: "pro",
            con: "con"
        }

        self.connections: dict[UUID, WebSocket] = {} # dict[user_id, WebSocket]

        self.both_connected = asyncio.Event()
        self.finished = asyncio.Event()


    async def run(self):
        try:
            async with SessionFactory() as session:
                topics = TopicRepository(session)
                self.topic = await topics.get_random_active()
                if self.topic is None:
                    raise RuntimeError("No active topic found")

            await self.both_connected.wait() # wait until both players' WebSocket is accepted

            await self.broadcast_initial_game_state()
            prompts = await self.receive_prompts()

            # TODO stream arguments from prompts
        finally:
            self.finished.set() # triggers connection cleanup

    async def broadcast_initial_game_state(self) -> None:
        if self.topic is None:
            raise RuntimeError("Topic has not been loaded when broadcasting")

        topic = TopicRead.model_validate(self.topic).model_dump(mode="json")

        participants = [
            {"user_id": str(user_id), "side": side}
            for user_id, side in self.sides.items()
        ]

        for player, socket in self.connections.items():
            await socket.send_json({
                "type": "MATCH_STATE",
                "payload": {
                    "match_id": str(self.match_id),
                    "topic": topic,
                    "you": self.sides[player],
                    "participants": participants
                }
            })

    async def receive_prompts(self):
        async with asyncio.TaskGroup() as group:
            tasks = {
                player: group.create_task(
                    self.receive_player_prompt(self.connections[player])
                )
                for player in self.players
            }

        return {
            player: task.result() for player, task in tasks.items()
        }

    async def receive_player_prompt(self, socket: WebSocket) -> str:
        while True:
            message = await socket.receive_json()

            if message["type"] != "SUBMIT_PROMPT":
                # TODO dispatch heartbeats, resign, etc.
                continue

            try:
                submission = PromptSubmission.model_validate(message.get("payload"))
            except ValidationError:
                await socket.send_json({
                    "type": "ERROR",
                    "payload": {
                        "code": "BAD_MESSAGE",
                        "message": "Prompt must be a string between 1 and 2000 characters.",
                    },
                })
                continue

            if not submission.prompt.strip():
                # TODO send ERROR, invalid prompt string
                continue

            return submission.prompt

    async def handle_connection(
            self,
            user_id: UUID,
            websocket: WebSocket
    ) -> None:
        self.connections[user_id] = websocket

        if all(player in self.connections for player in self.players):
            self.both_connected.set()

        try:
            await self.finished.wait()
        finally:
            if self.connections.get(user_id) is websocket:
                del self.connections[user_id]
