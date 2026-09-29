"""
Framework-independent exceptions classes.
Define exception handlers app/api/exception_handlers.py
"""

from uuid import UUID


class ServiceError(Exception):
    pass

class AlreadyQueuedError(ServiceError):
    def __init__(self, user_id: UUID):
        self.user_id = user_id
        super().__init__(f"User {user_id} is already queued")

class AlreadyMatchedError(ServiceError):
    def __init__(self, user_id: UUID, match_id: UUID):
        self.user_id = user_id
        self.match_id = match_id
        super().__init__(f"User {user_id} is already matched in {match_id}")

class MatchNotFoundError(ServiceError):
    pass
