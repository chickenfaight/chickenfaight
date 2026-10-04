import asyncio
import random
import time
from contextlib import suppress
from dataclasses import dataclass, field
from json import JSONDecodeError
from typing import Literal
from uuid import UUID

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.db.session import SessionFactory
from app.models import Topic
from app.repositories.topic import TopicRepository
from app.schemas.schemas import TopicRead, PromptSubmission

Side = Literal["pro", "con"]

@dataclass
class ConnectionActivity:
    last_received: float = field(default_factory=time.monotonic)


class GameEngine:
    HEARTBEAT_INTERVAL = 15
    HEARTBEAT_TIMEOUT = 45

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

        self.prompts: dict[UUID, str] = {}
        self.prompt_received = {player: asyncio.Event() for player in players}

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
        await asyncio.gather(*(event.wait() for event in self.prompt_received.values()))
        return dict(self.prompts)

    async def receive_messages(self, player: UUID, socket: WebSocket, activity: ConnectionActivity) -> None:
        while True:
            try:
                message = await socket.receive_json()
                activity.last_received = time.monotonic()
            except JSONDecodeError:
                activity.last_received = time.monotonic()
                await socket.send_json({
                    "type": "ERROR",
                    "payload": {
                        "code": "BAD_MESSAGE",
                        "message": "Malformed JSON",
                    },
                })
                continue

            if not isinstance(message, dict) or not isinstance(message.get("type"), str):
                await socket.send_json({
                    "type": "ERROR",
                    "payload": {
                        "code": "BAD_MESSAGE",
                        "message": "Malformed message",
                    },
                })
                continue

            if message["type"] != "SUBMIT_PROMPT":
                match message["type"]:
                    case "HEARTBEAT":
                        # The browser echoed our heartbeat; activity was updated above.
                        continue
                    case "RESIGN":
                        # TODO
                        continue
                    case _:
                        await socket.send_json({
                            "type": "ERROR",
                            "payload": {
                                "code": "UNKNOWN_TYPE",
                                "message": "Unknown message type",
                            },
                        })
                        continue

            if player in self.prompts:
                await socket.send_json({
                    "type": "ERROR",
                    "payload": {
                        "code": "PROMPT_ALREADY_SUBMITTED",
                        "message": "Prompt already accepted",
                    },
                })
                continue

            try:
                submission = PromptSubmission.model_validate(message.get("payload"))
            except ValidationError:
                await socket.send_json({
                    "type": "ERROR",
                    "payload": {
                        "code": "PROMPT_TOO_LONG",
                        "message": "Prompt must be a string between 1 and 2000 characters.",
                    },
                })
                continue

            if not submission.prompt.strip():
                await socket.send_json({
                    "type": "ERROR",
                    "payload": {
                        "code": "BAD_MESSAGE",
                        "message": "Invalid prompt string",
                    },
                })
                continue

            self.prompts[player] = submission.prompt
            self.prompt_received[player].set()
            # Keep reading heartbeat replies after accepting the prompt.

    async def heartbeat(self, socket: WebSocket, activity: ConnectionActivity) -> None:
        next_heartbeat = time.monotonic() + self.HEARTBEAT_INTERVAL
        while True:
            deadline = activity.last_received + self.HEARTBEAT_TIMEOUT
            await asyncio.sleep(max(0, min(next_heartbeat, deadline) - time.monotonic()))
            now = time.monotonic()
            if now - activity.last_received >= self.HEARTBEAT_TIMEOUT:
                await socket.close(code=4408, reason="Heartbeat timeout")
                return
            if now >= next_heartbeat:
                # A stalled send must not prevent the silence timeout check.
                try:
                    async with asyncio.timeout(activity.last_received + self.HEARTBEAT_TIMEOUT - now):
                        await socket.send_json({
                            "type": "HEARTBEAT",
                            "payload": {"ts": time.time()},
                        })
                except TimeoutError:
                    continue
                next_heartbeat = time.monotonic() + self.HEARTBEAT_INTERVAL

    async def handle_connection(self, user_id: UUID, websocket: WebSocket) -> None:
        self.connections[user_id] = websocket
        activity = ConnectionActivity()
        if all(player in self.connections for player in self.players):
            self.both_connected.set()

        reader = asyncio.create_task(self.receive_messages(user_id, websocket, activity))
        heartbeat = asyncio.create_task(self.heartbeat(websocket, activity))
        finished = asyncio.create_task(self.finished.wait())
        tasks = (reader, heartbeat, finished)
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (WebSocketDisconnect, OSError):
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if self.connections.get(user_id) is websocket:
                del self.connections[user_id]
            with suppress(WebSocketDisconnect, OSError, RuntimeError):
                await websocket.close()
