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

class ArenaNotFoundError(ServiceError):
    pass

class UserNotFoundError(ServiceError):
    def __init__(self, detail: str = "No player has that tag."):
        self.detail = detail
        super().__init__(detail)


class FriendSelfError(ServiceError):
    def __init__(self):
        super().__init__("You can't add yourself as a friend.")


class RateLimitedError(ServiceError):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after
        super().__init__(f"Rate limited; retry after {retry_after}s")


class TagError(ServiceError):
    """A user tag was rejected; `code`/`status_code`/`detail` map to PROTOCOL.md."""
    code: str
    status_code: int
    detail: str

    def __init__(self):
        super().__init__(self.detail)

class AvatarInvalidError(TagError):
    """Upload rejected; handled like tag errors."""
    code = "AVATAR_INVALID"
    status_code = 422
    detail = "Use a PNG, JPEG, or WebP image up to 2 MB."


class ConversationTooLongError(TagError):
    code = "CONVERSATION_TOO_LONG"
    status_code = 422
    detail = "This conversation is too long. Start a new one."


class ConversationInvalidError(TagError):
    code = "CONVERSATION_INVALID"
    status_code = 422
    detail = "Messages must alternate, starting and ending with yours."


class ModelUnavailableError(TagError):
    code = "MODEL_UNAVAILABLE"
    status_code = 502
    detail = "The model didn't respond. Try again or pick another model."


class ChallengeAlreadyCompletedError(TagError):
    code = "CHALLENGE_ALREADY_COMPLETED"
    status_code = 409
    detail = "You've already completed today's challenge. A new one starts at midnight UTC."


class UsernameError(TagError):
    """A username (the changeable display name) was rejected; handled like tag errors."""


class UsernameInvalidError(UsernameError):
    code = "USERNAME_INVALID"
    status_code = 422
    detail = "Usernames are 1–32 characters and can't be blank."

class UsernameNotAllowedError(UsernameError):
    code = "USERNAME_NOT_ALLOWED"
    status_code = 422
    detail = "That username isn't allowed. Try something else."

class TagInvalidError(TagError):
    code = "TAG_INVALID"
    status_code = 422
    detail = "Tags are 3–24 characters: letters, numbers, and underscores."

class TagNotAllowedError(TagError):
    code = "TAG_NOT_ALLOWED"
    status_code = 422
    detail = "That tag isn't allowed. Try something else."

class TagTakenError(TagError):
    code = "TAG_TAKEN"
    status_code = 409
    detail = "That tag is already taken."

class TagAlreadySetError(TagError):
    code = "TAG_ALREADY_SET"
    status_code = 409
    detail = "Your tag is already set and can't be changed."

class TagRequiredError(TagError):
    code = "TAG_REQUIRED"
    status_code = 403
    detail = "Create your tag before joining a debate."


class InvalidCredentialsError(ServiceError):
    """Wrong password, unknown tag, or an account without a password: one answer for all three,
    so sign-in can't be used to discover which tags exist."""

    def __init__(self):
        super().__init__("Incorrect tag or password.")

