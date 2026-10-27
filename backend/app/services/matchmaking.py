import asyncio
import logging
import time
from uuid import UUID, uuid4
from collections import deque, defaultdict
from dataclasses import dataclass
from datetime import date

from app.engine.game_engine import GameEngine
from app.services.arena import BYOM_ARENA_ID
from app.services.bilc_connections import BilcConnections
from app.services.bilc_rules import SizeClass, class_distance
from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError

logger = logging.getLogger(__name__)

QueueKey = tuple[UUID, date | None]
BYOM_KEY: QueueKey = (BYOM_ARENA_ID, None)

# How long a BYOM player waits for their own size class before neighboring classes are allowed.
BYOM_WIDEN_AFTER = 30.0


@dataclass(frozen=True)
class ByomEntry:
    user_id: UUID
    device_id: UUID
    size_class: SizeClass
    joined_at: float  # time.monotonic()


def pair_byom(entries: list[ByomEntry], now: float, widen_after: float = BYOM_WIDEN_AFTER) -> list[tuple[ByomEntry, ByomEntry]]:
    """Pair BYOM players, longest-waiting first: within a size class, or with a neighboring class
    once either of the two has waited `widen_after` seconds. `entries` is in join order."""
    waiting = list(entries)
    pairs = []
    while waiting:
        first = waiting.pop(0)
        partner = next((other for other in waiting if other.size_class == first.size_class), None)
        if partner is None:
            partner = next((
                other for other in waiting
                if class_distance(first.size_class, other.size_class) == 1
                and now - min(first.joined_at, other.joined_at) >= widen_after
            ), None)
        if partner is not None:
            waiting.remove(partner)
            pairs.append((first, partner))
    return pairs


class Matchmaker:
    def __init__(self, bilc: BilcConnections | None = None):
        self.bilc = bilc if bilc is not None else BilcConnections()
        # BYOM players wait here instead of `queues`: they pair by device size class (`pair_byom`).
        self.byom_queue: list[ByomEntry] = []
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

                self.start(GameEngine(match_id, players, model_id, challenge_day))
        self.match_byom_players()

    def match_byom_players(self) -> None:
        # Devices that went offline (or got busy) since queueing wait without being paired.
        ready = [entry for entry in self.byom_queue if self.bilc.status(entry.device_id) == "idle"]
        for first, second in pair_byom(ready, time.monotonic()):
            match_id = uuid4()
            if not self.bilc.reserve(first.device_id, match_id):
                continue
            if not self.bilc.reserve(second.device_id, match_id):
                self.bilc.release(first.device_id, match_id)
                continue
            for entry in (first, second):
                self.byom_queue.remove(entry)
                del self.queued_users[entry.user_id]
                self.assignments[entry.user_id] = match_id
            devices = {first.user_id: first.device_id, second.user_id: second.device_id}
            self.start(GameEngine(match_id, (first.user_id, second.user_id), BYOM_ARENA_ID,
                                  devices=devices, bilc=self.bilc))

    def start(self, game: GameEngine) -> None:
        self.engines[game.match_id] = game
        self.tasks[game.match_id] = asyncio.create_task(
            self.run_match(game),
            name=f"match-{game.match_id}",
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
            # The engine frees its devices when it ends; this covers a crash before that.
            for device_id in game.devices.values():
                self.bilc.release(device_id, game.match_id)

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
        self.check_free(user_id)
        key = (model_id, challenge_day)
        self.queues[key].append(user_id)
        self.queued_users[user_id] = key

    def register_byom(self, user_id: UUID, device_id: UUID, size_class: SizeClass) -> None:
        """Queue for the BYOM arena with one of the user's devices (the route checked it's idle)."""
        self.check_free(user_id)
        self.byom_queue.append(ByomEntry(user_id, device_id, size_class, time.monotonic()))
        self.queued_users[user_id] = BYOM_KEY

    def check_free(self, user_id: UUID) -> None:
        if user_id in self.queued_users:
            raise AlreadyQueuedError(user_id)
        if (match_id := self.active_match(user_id)) is not None:
            raise AlreadyMatchedError(user_id, match_id)

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

        key = self.queued_users.pop(user_id)
        if key == BYOM_KEY:
            self.byom_queue = [entry for entry in self.byom_queue if entry.user_id != user_id]
        else:
            self.queues[key].remove(user_id)
