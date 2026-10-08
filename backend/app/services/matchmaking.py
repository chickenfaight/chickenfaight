import asyncio
import logging
from uuid import UUID, uuid4
from collections import deque, defaultdict
from datetime import date

from app.engine.game_engine import GameEngine
from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError

logger = logging.getLogger(__name__)

QueueKey = tuple[UUID, date | None]


class Matchmaker:
    def __init__(self):
        # One queue per (model_id, challenge_day): regular matches use challenge_day None; daily-challenge
        # players wait in their own queue so they only meet others playing today's challenge.
        self.queues: defaultdict[QueueKey, deque[UUID]] = defaultdict(deque)
        self.queued_users: dict[UUID, QueueKey] = {} # dict[user_id, queue key] for checks and cancellation
        self.assignments: dict[UUID, UUID] = {} # dict[user_id, match_id]

        self.engines: dict[UUID, GameEngine] = {}       # dict[match_id, engine]
        self.tasks: dict[UUID, asyncio.Task[None]] = {} # dict[match_id, async task]

    async def run(self):
        while True:
            await self.match_available_players()
            await asyncio.sleep(1)

    async def match_available_players(self):
        # TODO more sophisticated matching algorithm with elo and shi coming soon
        for (model_id, challenge_day), queue in self.queues.items():
            while len(queue) >= 2:
                match_id = uuid4()
                players = (queue.popleft(), queue.popleft())

                for user_id in players:
                    del self.queued_users[user_id]
                    self.assignments[user_id] = match_id

                game = GameEngine(match_id, players, model_id, challenge_day)
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


    def register(self, user_id: UUID, model_id: UUID, challenge_day: date | None = None):
        if user_id in self.queued_users:
            raise AlreadyQueuedError(user_id)
        if (match_id := self.active_match(user_id)) is not None:
            raise AlreadyMatchedError(user_id, match_id)

        key = (model_id, challenge_day)
        self.queues[key].append(user_id)
        self.queued_users[user_id] = key

    def get_status(self, user_id: UUID) -> dict[str, str]:
        if (match_id := self.active_match(user_id)) is not None:
            return {
                "status": "matched",
                "match_id": str(match_id),
            }

        if user_id in self.queued_users:
            return {"status": "queued"}

        return {"status": "none"}

    def remove_user(self, user_id: UUID) -> None:
        """Take a user out of matchmaking entirely (account deletion): leave any queue, and
        forfeit a live match so the opponent gets the win."""
        if (match_id := self.active_match(user_id)) is not None:
            self.engines[match_id].resign(user_id)
        else:
            self.cancel(user_id)

    def cancel(self, user_id: UUID):
        if (match_id := self.active_match(user_id)) is not None:
            raise AlreadyMatchedError(user_id, match_id)

        if user_id not in self.queued_users:
            return

        key = self.queued_users[user_id]
        self.queues[key].remove(user_id)
        del self.queued_users[user_id]
