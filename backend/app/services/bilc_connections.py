"""Connected BILC devices (PROTOCOL.md, "WebSocket — BILC"), kept in this process's memory like matchmaking.

Each device is offline (no socket), idle, or busy (reserved for a match). A reservation outlives the
socket, so a device that reconnects mid-match is sent its `MATCH_ASSIGN` again and keeps playing.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError

from app.auth.bilc import BilcIdentity
from app.config import settings
from app.db.session import SessionFactory
from app.inference.model_client import DeviceTurnError, Message
from app.schemas import Hello
from app.services.bilc import BilcService
from app.services.bilc_rules import SizeClass, is_outdated, size_class

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1
MAX_TURN_DELTA_BYTES = 8 * 1024
MAX_TURN_BUFFER_BYTES = 32 * 1024
MAX_TURN_BUFFER_FRAMES = 512

DeviceStatus = Literal["offline", "idle", "busy"]
RecordHello = Callable[[BilcIdentity, Hello], Awaitable[bool]]


async def save_hello(identity: BilcIdentity, hello: Hello) -> bool:
    async with SessionFactory() as session:
        return await BilcService(session).record_hello(identity, hello)


class BadFrame(Exception):
    pass


class MatchResponse(BaseModel):
    turn_id: UUID
    delta: str = ""
    done: bool = False
    finish_reason: str | None = None


class DeviceError(BaseModel):
    code: str = Field(max_length=64)
    message: str = Field(default="", max_length=500)
    turn_id: UUID | None = None


@dataclass
class Assignment:
    """A device's reservation for one match; `side` and `topic` are set once `MATCH_ASSIGN` is sent."""
    match_id: UUID
    side: str | None = None
    topic: str | None = None


@dataclass
class TurnBuffer:
    # Reserve one slot for a terminal error even when the response buffer is full.
    queue: asyncio.Queue[tuple[str, bool, int] | DeviceTurnError] = field(
        default_factory=lambda: asyncio.Queue(MAX_TURN_BUFFER_FRAMES + 1)
    )
    queued_bytes: int = 0

    def append(self, response: MatchResponse) -> bool:
        delta = response.delta
        if self.queue.qsize() >= MAX_TURN_BUFFER_FRAMES or len(delta) > MAX_TURN_DELTA_BYTES:
            return False
        try:
            size = len(delta.encode("utf-8"))
        except UnicodeEncodeError:
            return False
        if size > MAX_TURN_DELTA_BYTES or self.queued_bytes + size > MAX_TURN_BUFFER_BYTES:
            return False
        self.queue.put_nowait((delta, response.done, size))
        self.queued_bytes += size
        return True

    def reject_response(self) -> None:
        while not self.queue.empty():
            self.queue.get_nowait()
        self.queued_bytes = 0
        self.queue.put_nowait(DeviceTurnError("MODEL_ERROR", "Invalid or over-budget device response"))

    async def next_response(self) -> tuple[str, bool]:
        event = await self.queue.get()
        if isinstance(event, DeviceTurnError):
            raise event
        delta, done, size = event
        self.queued_bytes -= size
        return delta, done


@dataclass(eq=False)
class DeviceConnection:
    identity: BilcIdentity
    socket: WebSocket
    hello: Hello | None = None
    last_received: float = field(default_factory=time.monotonic)
    closed: asyncio.Event = field(default_factory=asyncio.Event)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    turns: dict[UUID, TurnBuffer] = field(default_factory=dict)

    async def send(self, type_: str, payload: dict[str, Any]) -> None:
        async with self.send_lock:
            if self.closed.is_set():
                raise WebSocketDisconnect()
            await self.socket.send_json({"type": type_, "payload": payload})

    async def error(self, code: str, message: str) -> None:
        await self.send("ERROR", {"code": code, "message": message})

    async def receive(self) -> tuple[str, dict[str, Any]]:
        """The next frame's `type` and `payload`; `BadFrame` if it isn't a JSON envelope."""
        message = await self.socket.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code", 1000))
        self.last_received = time.monotonic()
        try:
            frame = json.loads(message.get("text") or "")
        except ValueError:
            raise BadFrame("Malformed JSON") from None
        if not isinstance(frame, dict) or not isinstance(frame.get("type"), str):
            raise BadFrame("Malformed message")
        payload = frame.get("payload", {})
        if not isinstance(payload, dict):
            raise BadFrame("Payload must be an object")
        return frame["type"], payload

    def mark_closed(self) -> bool:
        if self.closed.is_set():
            return False
        self.closed.set()
        # Turns still waiting on this socket fail now rather than at their deadline.
        for turn in self.turns.values():
            turn.queue.put_nowait(DeviceTurnError("BILC_DISCONNECTED", "The device disconnected"))
        self.turns.clear()
        return True

    async def send_close(self, code: int, reason: str) -> None:
        with suppress(WebSocketDisconnect, OSError, RuntimeError):
            await self.socket.close(code=code, reason=reason)

    async def close(self, code: int, reason: str) -> None:
        if self.mark_closed():
            await self.send_close(code, reason)


class BilcConnections:
    """One live socket per device; a newer connection replaces the older one (4409)."""

    HEARTBEAT_INTERVAL = 15
    HEARTBEAT_TIMEOUT = 45
    TURN_TIMEOUT = 90  # sent as the TURN_REQUEST deadline; the engine enforces it

    def __init__(
        self,
        record_hello: RecordHello = save_hello,
        min_version: str | None = None,
        allow_dev: bool | None = None,
    ):
        self.record_hello = record_hello
        self.min_version = min_version or settings.bilc_min_supported_version
        self.allow_dev = settings.app_env == "development" if allow_dev is None else allow_dev
        self.connections: dict[UUID, DeviceConnection] = {}
        self.pending: dict[UUID, set[DeviceConnection]] = {}
        self.assignments: dict[UUID, Assignment] = {}  # dict[device_id, its match]

    # Status

    def online(self, user_id: UUID) -> set[UUID]:
        return {
            device_id
            for device_id, connection in self.connections.items()
            if connection.identity.user_id == user_id
        }

    def status(self, device_id: UUID) -> DeviceStatus:
        if device_id in self.assignments:
            return "busy"
        return "idle" if device_id in self.connections else "offline"

    def hello(self, device_id: UUID) -> Hello | None:
        connection = self.connections.get(device_id)
        return connection.hello if connection else None

    def size_class(self, device_id: UUID) -> SizeClass | None:
        hello = self.hello(device_id)
        return size_class(hello.model.model_dump()) if hello else None

    # Matches

    def reserve(self, device_id: UUID, match_id: UUID) -> bool:
        """Mark an idle, connected device busy for a match; False if it's offline or busy."""
        if self.status(device_id) != "idle":
            return False
        self.assignments[device_id] = Assignment(match_id)
        return True

    def release(self, device_id: UUID, match_id: UUID) -> None:
        assignment = self.assignments.get(device_id)
        if assignment is not None and assignment.match_id == match_id:
            del self.assignments[device_id]

    async def assign(self, device_id: UUID, match_id: UUID, side: str, topic: str) -> None:
        assignment = self.assignments.get(device_id)
        if assignment is None or assignment.match_id != match_id:
            return
        assignment.side, assignment.topic = side, topic
        await self.send(device_id, "MATCH_ASSIGN", self.assign_payload(assignment))

    async def end_match(self, device_id: UUID, match_id: UUID, status: str) -> None:
        """Tell the device the match is over (it cancels anything in flight) and make it idle."""
        if device_id in self.assignments and self.assignments[device_id].match_id == match_id:
            await self.send(device_id, "MATCH_END", {"match_id": str(match_id), "status": status})
        self.release(device_id, match_id)

    async def forfeit(self, device_id: UUID, match_id: UUID, reason: str) -> None:
        await self.send(device_id, "FORFEIT", {"match_id": str(match_id), "reason": reason})

    async def turn(self, device_id: UUID, match_id: UUID, messages: list[Message], max_tokens: int) -> AsyncIterator[str]:
        """Send one `TURN_REQUEST` and yield its deltas, or raise `DeviceTurnError` on failure.

        Closing the generator abandons the turn. The device stops it on `MATCH_END`, and any
        late responses are ignored as unknown turns.
        """
        connection = self.connections.get(device_id)
        if connection is None:
            raise DeviceTurnError("BILC_OFFLINE", "The device is offline")
        turn_id = uuid4()
        turn = TurnBuffer()
        connection.turns[turn_id] = turn
        try:
            await connection.send("TURN_REQUEST", {
                "turn_id": str(turn_id),
                "match_id": str(match_id),
                "phase": "opening",
                "messages": messages,
                "max_tokens": max_tokens,
                "deadline": (datetime.now(timezone.utc) + timedelta(seconds=self.TURN_TIMEOUT)).isoformat(),
            })
            while True:
                delta, done = await turn.next_response()
                if delta:
                    yield delta
                if done:
                    return
        except (WebSocketDisconnect, OSError, RuntimeError) as exc:
            raise DeviceTurnError("BILC_DISCONNECTED", "The device disconnected") from exc
        finally:
            connection.turns.pop(turn_id, None)

    async def send(self, device_id: UUID, type_: str, payload: dict[str, Any]) -> None:
        connection = self.connections.get(device_id)
        if connection is None:
            return
        with suppress(WebSocketDisconnect, OSError, RuntimeError):
            await connection.send(type_, payload)

    @staticmethod
    def assign_payload(assignment: Assignment) -> dict[str, Any]:
        return {"match_id": str(assignment.match_id), "side": assignment.side, "topic": assignment.topic}

    # Sockets

    async def close(self, device_id: UUID, code: int, reason: str) -> None:
        sockets = self.pending.pop(device_id, set())
        connection = self.connections.pop(device_id, None)
        if connection is not None:
            sockets.add(connection)
        # Invalidate every socket before sending any close frame can yield.
        await asyncio.gather(*(socket.send_close(code, reason) for socket in sockets if socket.mark_closed()))

    async def close_user(self, user_id: UUID) -> None:
        pending_ids = {
            device_id for device_id, sockets in self.pending.items()
            if any(socket.identity.user_id == user_id for socket in sockets)
        }
        for device_id in self.online(user_id) | pending_ids:
            await self.close(device_id, 4403, "Account deleted")

    async def serve(self, identity: BilcIdentity, socket: WebSocket) -> None:
        """Run an accepted, authenticated socket until it closes."""
        device_id = identity.device_id
        connection = DeviceConnection(identity, socket)
        pending = self.pending.setdefault(device_id, set())
        pending.add(connection)
        tasks: list[asyncio.Task] = []
        try:
            try:
                hello = await self.handshake(connection)
                if hello is None or connection.closed.is_set():
                    return
                if not await self.record_hello(identity, hello):
                    await connection.close(4403, "Device revoked")
                    return
                if connection.closed.is_set():
                    return
            finally:
                pending.discard(connection)
                if not pending and self.pending.get(device_id) is pending:
                    del self.pending[device_id]
            connection.hello = hello
            previous = self.connections.get(device_id)
            self.connections[device_id] = connection
            if previous is not None:
                await previous.close(4409, "Replaced by a newer connection")
            await connection.send("HELLO_ACK", {
                "protocol_version": PROTOCOL_VERSION,
                "heartbeat_interval_s": self.HEARTBEAT_INTERVAL,
            })
            logger.info("BILC %s connected (client %s)", device_id, hello.client_version)
            # Reconnected mid-match: the device needs its assignment again.
            assignment = self.assignments.get(device_id)
            if assignment is not None and assignment.side is not None:
                await connection.send("MATCH_ASSIGN", self.assign_payload(assignment))

            tasks = [
                asyncio.create_task(self.read(connection)),
                asyncio.create_task(self.heartbeat(connection)),
                asyncio.create_task(connection.closed.wait()),
            ]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (WebSocketDisconnect, OSError):
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if self.connections.get(device_id) is connection:
                del self.connections[device_id]
            await connection.close(1000, "")

    async def handshake(self, connection: DeviceConnection) -> Hello | None:
        """Wait for a valid `HELLO`, which must come first. None if the socket was closed instead."""
        try:
            async with asyncio.timeout(self.HEARTBEAT_TIMEOUT):
                while not connection.closed.is_set():
                    try:
                        type_, payload = await connection.receive()
                    except BadFrame as problem:
                        await connection.error("BAD_MESSAGE", str(problem))
                        continue
                    if type_ == "DISCONNECT":
                        await connection.close(1000, "Disconnected")
                        return None
                    if type_ != "HELLO":
                        await connection.error("BAD_MESSAGE", "Send HELLO first")
                        continue
                    try:
                        hello = Hello.model_validate(payload)
                    except ValidationError:
                        await connection.error("BAD_MESSAGE", "Invalid HELLO")
                        continue
                    if hello.protocol_version != PROTOCOL_VERSION:
                        await connection.close(4426, "UNSUPPORTED_VERSION")
                        return None
                    if is_outdated(hello.client_version, self.min_version, self.allow_dev):
                        await connection.close(4426, "BILC_OUTDATED: run bilc update")
                        return None
                    return hello
        except TimeoutError:
            await connection.close(4408, "Heartbeat timeout")
        return None

    async def read(self, connection: DeviceConnection) -> None:
        while not connection.closed.is_set():
            try:
                await self.handle_message(connection, *await connection.receive())
            except BadFrame as problem:
                await connection.error("BAD_MESSAGE", str(problem))

    async def handle_message(self, connection: DeviceConnection, type_: str, payload: dict[str, Any]) -> None:
        # Keep each payload scoped to its dispatch so rejected text is released before the next read.
        match type_:
            case "HEARTBEAT":
                # receive() already updated last_received.
                return
            case "DISCONNECT":
                await connection.close(1000, "Disconnected")
            case "MATCH_RESPONSE":
                try:
                    response = MatchResponse.model_validate(payload)
                except ValidationError:
                    await connection.error("BAD_MESSAGE", "Invalid MATCH_RESPONSE")
                    return
                turn = connection.turns.get(response.turn_id)
                if turn is None:
                    return
                if not turn.append(response):
                    del connection.turns[response.turn_id]
                    turn.reject_response()
                elif response.done:
                    del connection.turns[response.turn_id]
            case "ERROR":
                try:
                    error = DeviceError.model_validate(payload)
                except ValidationError:
                    return
                turn = connection.turns.pop(error.turn_id, None) if error.turn_id is not None else None
                if turn is not None:
                    turn.queue.put_nowait(DeviceTurnError(error.code, error.message))
                else:
                    logger.info("BILC %s reported %s", connection.identity.device_id, error.code)
            case "HELLO":
                await connection.error("BAD_MESSAGE", "Already connected")
            case _:
                await connection.error("UNKNOWN_TYPE", "Unknown message type")

    async def heartbeat(self, connection: DeviceConnection) -> None:
        next_heartbeat = time.monotonic() + self.HEARTBEAT_INTERVAL
        while True:
            deadline = connection.last_received + self.HEARTBEAT_TIMEOUT
            await asyncio.sleep(max(0, min(next_heartbeat, deadline) - time.monotonic()))
            now = time.monotonic()
            if now - connection.last_received >= self.HEARTBEAT_TIMEOUT:
                await connection.close(4408, "Heartbeat timeout")
                return
            if now >= next_heartbeat:
                # A stalled send must not prevent the silence timeout check.
                try:
                    async with asyncio.timeout(connection.last_received + self.HEARTBEAT_TIMEOUT - now):
                        await connection.send("HEARTBEAT", {"ts": time.time()})
                except TimeoutError:
                    continue
                next_heartbeat = time.monotonic() + self.HEARTBEAT_INTERVAL
