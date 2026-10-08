"""Rules for usernames: the changeable display name (`users.username`). Unlike tags, they aren't unique."""

import unicodedata

from app.services.exceptions import UsernameInvalidError, UsernameNotAllowedError
from app.services.tags import is_profane

MAX_LENGTH = 32


def validate_username(username: str) -> str:
    """Returns the username with surrounding whitespace removed, or raises."""
    username = username.strip()
    # Control and other invisible format characters could make names look blank or spoof others.
    if not 1 <= len(username) <= MAX_LENGTH or any(unicodedata.category(ch) in ("Cc", "Cf") for ch in username):
        raise UsernameInvalidError()
    if is_profane(username):
        raise UsernameNotAllowedError()
    return username
