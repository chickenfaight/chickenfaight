import asyncio
import logging
from uuid import UUID, uuid4
from collections import deque, defaultdict

from app.engine.game_engine import GameEngine
from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError

logger = logging.getLogger(__name__)


class Matchmaker:
    def __init__(self):
        self.queues: defaultdict[UUID, deque[UUID]] = defaultdict(deque) # dict[model_id, user id queue]
        self.queued_users: dict[UUID, UUID] = {} # dict[user_id, model_id] for checks and cancellation
        self.assignments: dict[UUID, UUID] = {} # dict[user_id, match_id]

        self.engines: dict[UUID, GameEngine] = {}       # dict[match_id, engine]
        self.tasks: dict[UUID, asyncio.Task[None]] = {} # dict[match_id, async task]

    async def run(self):
        while True:
            await self.match_available_players()
            await asyncio.sleep(1)

    async def match_available_players(self):
        # TODO more sophisticated matching algorithm with elo and shi coming soon
        for model_id, queue in self.queues.items():
            while len(queue) >= 2:
                match_id = uuid4()
                players = (queue.popleft(), queue.popleft())

                for user_id in players:
                    del self.queued_users[user_id]
                    self.assignments[user_id] = match_id

                game = GameEngine(match_id, players, model_id)
                self.engines[match_id] = game
                self.tasks[match_id] = asyncio.create_task(
                    self.run_match(game),
                    name=f"match-{match_id}",
                )

    async def run_match(self, game: GameEngine):
        try:
            await game.run()
        except Exception:
            # Nothing awaits this task, so log here or the error is lost.
            logger.exception("Match %s crashed", game.match_id)
        finally:
            for user_id in game.players:
                self.assignments.pop(user_id, None)

            self.engines.pop(game.match_id, None)
            self.tasks.pop(game.match_id, None)

    def active_match(self, user_id: UUID) -> UUID | None:
        """The user's match, unless its result is decided (it's only cleaning up)."""
        match_id = self.assignments.get(user_id)
        engine = self.engines.get(match_id) if match_id else None
        if match_id is None or (engine is not None and engine.result is not None):
            return None
        return match_id


    def register(self, user_id: UUID, model_id: UUID):
        if user_id in self.queued_users:
            raise AlreadyQueuedError(user_id)
        if (match_id := self.active_match(user_id)) is not None:
            raise AlreadyMatchedError(user_id, match_id)

        self.queues[model_id].append(user_id)
        self.queued_users[user_id] = model_id

    def get_status(self, user_id: UUID) -> dict[str, str]:
        if (match_id := self.active_match(user_id)) is not None:
            return {
                "status": "matched",
                "match_id": str(match_id),
            }

        if user_id in self.queued_users:
            return {"status": "queued"}

        return {"status": "none"}

    def cancel(self, user_id: UUID):
        if (match_id := self.active_match(user_id)) is not None:
            raise AlreadyMatchedError(user_id, match_id)

        if user_id not in self.queued_users:
            return

        model_id = self.queued_users[user_id]
        self.queues[model_id].remove(user_id)
        del self.queued_users[user_id]
