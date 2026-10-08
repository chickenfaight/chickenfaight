import asyncio
import time
import unittest
from uuid import uuid4

from fastapi import WebSocketDisconnect
from app.engine.game_engine import GameEngine


class Socket:
    def __init__(self):
        self.messages = asyncio.Queue()
        self.sent = asyncio.Queue()
        self.closes = []

    async def receive_json(self):
        message = await self.messages.get()
        if isinstance(message, Exception):
            raise message
        return message

    async def send_json(self, message):
        await self.sent.put(message)

    async def close(self, code=1000, reason=None):
        if self.closes:
            raise RuntimeError('already closed')
        self.closes.append(code)


class HeartbeatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.players = (uuid4(), uuid4())
        self.engine = GameEngine(uuid4(), self.players, uuid4())
        self.engine.HEARTBEAT_INTERVAL = 0.01
        self.engine.HEARTBEAT_TIMEOUT = 0.08
        self.tasks = []

    async def asyncTearDown(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    def connect(self, player):
        socket = Socket()
        task = asyncio.create_task(self.engine.handle_connection(player, socket))
        self.tasks.append(task)
        return socket, task

    async def test_silent_connection_closes_4408(self):
        socket, task = self.connect(self.players[0])
        await asyncio.wait_for(task, 1)
        self.assertEqual(socket.closes, [4408])
        self.assertFalse(self.engine.connections)

    async def test_replies_after_prompt_keep_only_that_connection_alive(self):
        active, active_task = self.connect(self.players[0])
        silent, silent_task = self.connect(self.players[1])
        await active.messages.put({'type': 'SUBMIT_PROMPT', 'payload': {'prompt': 'accepted'}})
        await asyncio.wait_for(self.engine.prompt_received[self.players[0]].wait(), 1)
        until = time.monotonic() + self.engine.HEARTBEAT_TIMEOUT * 2
        while time.monotonic() < until:
            message = await asyncio.wait_for(active.sent.get(), 1)
            self.assertEqual(message['type'], 'HEARTBEAT')
            await active.messages.put(message)
        self.assertFalse(active_task.done())
        await asyncio.wait_for(silent_task, 1)
        self.assertEqual(silent.closes, [4408])
        self.assertEqual(self.engine.prompts[self.players[0]], 'accepted')
        self.engine.finished.set()
        await asyncio.wait_for(active_task, 1)
        self.assertEqual(active.closes, [1000])

    async def test_disconnect_stops_heartbeat(self):
        socket, task = self.connect(self.players[0])
        await socket.messages.put(WebSocketDisconnect())
        await asyncio.wait_for(task, 1)
        self.assertTrue(socket.sent.empty())
        self.assertFalse(self.engine.connections)
