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

class UserNotFoundError(ServiceError):
    pass


class UsernameError(ServiceError):
    """A user tag was rejected; `code`/`status_code`/`detail` map to PROTOCOL.md."""
    code: str
    status_code: int
    detail: str

    def __init__(self):
        super().__init__(self.detail)

class UsernameInvalidError(UsernameError):
    code = "USERNAME_INVALID"
    status_code = 422
    detail = "Tags are 3–24 characters: letters, numbers, and underscores."

class UsernameNotAllowedError(UsernameError):
    code = "USERNAME_NOT_ALLOWED"
    status_code = 422
    detail = "That tag isn't allowed. Try something else."

class UsernameTakenError(UsernameError):
    code = "USERNAME_TAKEN"
    status_code = 409
    detail = "That tag is already taken."

class UsernameAlreadySetError(UsernameError):
    code = "USERNAME_ALREADY_SET"
    status_code = 409
    detail = "Your tag is already set and can't be changed."

class UsernameRequiredError(UsernameError):
    code = "USERNAME_REQUIRED"
    status_code = 403
    detail = "Create your tag before joining a debate."
