"""A fake BILC device for tests: an in-memory socket that `BilcConnections.serve` runs like a real one.

The test plays the device: `say()` sends it a frame, `next()` reads what the server sent (skipping
heartbeats), and `reply_to_turns()` answers every `TURN_REQUEST` from a script.
"""
import asyncio
import json
from uuid import UUID, uuid4

from app.auth.bilc import BilcIdentity

HELLO = {
    "protocol_version": 1,
    "client_version": "0.1.0",
    "platform": "linux/amd64",
    "model": {"name": "llama3.2:3b", "context_length": 8192, "metadata": {"parameter_size": "3.2B"}},
}


class FakeBilc:
    def __init__(self, user_id: UUID | None = None):
        self.identity = BilcIdentity(device_id=uuid4(), user_id=user_id or uuid4())
        self.inbox: asyncio.Queue[str | None] = asyncio.Queue()
        self.outbox: asyncio.Queue[dict] = asyncio.Queue()
        # Every non-heartbeat message the server sent, in order, whoever read it.
        self.seen: list[dict] = []
        self.close_code: int | None = None
        self.close_reason = ""
        self.task: asyncio.Task | None = None
        self.replier: asyncio.Task | None = None

    @property
    def device_id(self) -> UUID:
        return self.identity.device_id

    # The WebSocket methods BilcConnections uses.

    async def receive(self) -> dict:
        text = await self.inbox.get()
        if text is None:
            return {"type": "websocket.disconnect", "code": 1000}
        return {"type": "websocket.receive", "text": text}

    async def send_json(self, message: dict) -> None:
        if self.close_code is not None:
            raise RuntimeError("closed")
        if message["type"] != "HEARTBEAT":
            self.seen.append(message)
        await self.outbox.put(message)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self.close_code is None:
            self.close_code, self.close_reason = code, reason
            self.inbox.put_nowait(None)

    # The test's side.

    def say(self, type_: str, payload: dict) -> None:
        self.inbox.put_nowait(json.dumps({"type": type_, "payload": payload}))

    def hang_up(self) -> None:
        self.inbox.put_nowait(None)

    async def next(self, type_: str | None = None, timeout: float = 2) -> dict:
        while True:
            message = await asyncio.wait_for(self.outbox.get(), timeout)
            if message["type"] == "HEARTBEAT":
                continue
            if type_ is not None and message["type"] != type_:
                raise AssertionError(f"expected {type_}, got {message}")
            return message

    async def connect(self, connections, hello: dict = HELLO) -> dict:
        """Run the server side of this socket, say HELLO, and return the server's reply."""
        self.task = asyncio.create_task(connections.serve(self.identity, self))
        self.say("HELLO", hello)
        return await self.next()

    def reply_to_turns(self, script):
        """Answer each TURN_REQUEST in order: a list of deltas streams them and finishes, an
        `("ERROR", code)` tuple reports a model error, and None never answers."""
        sent: list[dict] = []

        async def run():
            for reply in script:
                request = await self.next(timeout=10)
                while request["type"] != "TURN_REQUEST":  # e.g. MATCH_ASSIGN; still in `seen`
                    request = await self.next(timeout=10)
                sent.append(request["payload"])
                turn_id = request["payload"]["turn_id"]
                if reply is None:
                    continue
                if isinstance(reply, tuple):
                    self.say("ERROR", {"code": reply[1], "message": "local model failed", "turn_id": turn_id})
                    continue
                for delta in reply:
                    self.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": delta, "done": False, "finish_reason": None})
                self.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "", "done": True, "finish_reason": "stop"})

        self.replier = asyncio.create_task(run())
        return sent

    async def stop(self) -> None:
        for task in (self.replier, self.task):
            if task is not None:
                task.cancel()
        await asyncio.gather(*(t for t in (self.replier, self.task) if t), return_exceptions=True)
