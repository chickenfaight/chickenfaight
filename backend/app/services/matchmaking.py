from uuid import UUID
from collections import deque, defaultdict

from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError


class Matchmaker:
    def __init__(self):
        self.queues: defaultdict[str, deque[UUID]] = defaultdict(deque)
        self.queued_users: set[UUID] = set()    # set[user_id] for quick duplicate/status checks
        self.assignments: dict[UUID, UUID] = {} # dict[user_id, match_id]

    def register(self, user_id: UUID):
        if user_id in self.queued_users:
            raise AlreadyQueuedError(user_id)
        if user_id in self.assignments:
            raise AlreadyMatchedError(user_id, self.assignments[user_id])

        self.queues["provided"].appendleft(user_id) # TODO hardcoded stuff here
        # hardcode provided arena for now, update with model-based arena / matchmaking
        return self.try_pair()

    def get_status(self, user_id: UUID) -> dict[str, str]:
        if user_id in self.assignments:
            return {
                "status": "matched",
                "match_id": str(self.assignments[user_id]),
            }

        if user_id in self.queued_users:
            return {"status": "queued"}

        return {"status": "none"}

    def cancel(self, user_id: UUID):
        if user_id in self.assignments:
            raise AlreadyMatchedError(user_id, self.assignments[user_id])

        self.queues["provided"].remove(user_id) # TODO hardcoded stuff here
        self.queued_users.remove(user_id)

    def try_pair(self):
        # TODO more sophisticated matching algorithm with elo and shi coming soon
        # attempts pairing on every join request, later implement periodic attempts or some other way idk
        if len(self.queues["provided"]) >= 2: # TODO hardcoded stuff here
            return self.queues["provided"].popleft(), self.queues["provided"].popleft()
        return None # TODO spawn match here

    def finish_match(self, match_id: UUID):
        pass # TODO
