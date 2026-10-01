"""Format and content rules for user tags (`users.username`)."""

import re

from better_profanity import profanity

from app.services.exceptions import UsernameInvalidError, UsernameNotAllowedError


USERNAME_PATTERN = re.compile(r"[A-Za-z0-9_]{3,24}")

profanity.load_censor_words()

# better-profanity only matches whole words, but tags glue words together
# ("bigshit"), so these unambiguous stems are also blocked as substrings.
# Words that appear inside innocent ones (ass/class, rape/grape, spic/spice)
# stay whole-word only.
BLOCKED_SUBSTRINGS = (
    "fuck", "shit", "bitch", "cunt", "nigg", "faggot", "whore", "slut",
    "pussy", "porn", "kike", "chink", "tranny",
)
LEETSPEAK = str.maketrans("013457@$!", "oieastasi")


def is_profane(username: str) -> bool:
    words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", username).replace("_", " ")
    words_without_digits = re.sub(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", words)
    if profanity.contains_profanity(words) or profanity.contains_profanity(words_without_digits):
        return True

    squashed = username.lower().translate(LEETSPEAK).replace("_", "")
    return any(stem in squashed for stem in BLOCKED_SUBSTRINGS)


def validate_username(username: str) -> str:
    if not USERNAME_PATTERN.fullmatch(username):
        raise UsernameInvalidError()
    if is_profane(username):
        raise UsernameNotAllowedError()
    return username
