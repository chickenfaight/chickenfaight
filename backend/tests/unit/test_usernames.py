import pytest

from app.services.exceptions import UsernameInvalidError, UsernameNotAllowedError
from app.services.usernames import is_profane, validate_username


@pytest.mark.parametrize("username", ["abc", "Ryan_72", "a" * 24, "___", "UPPER", "123"])
def test_valid_formats_are_accepted(username: str):
    assert validate_username(username) == username


@pytest.mark.parametrize(
    "username",
    ["", "ab", "a" * 25, "has space", " padded", "padded ", "dash-ed", "dot.ted",
     "émile", "emoji🐔", "semi;colon", "new\nline", "abc\n"],
)
def test_invalid_formats_are_rejected(username: str):
    with pytest.raises(UsernameInvalidError):
        validate_username(username)


@pytest.mark.parametrize(
    "username",
    ["shit", "sh1t", "big_shit", "bigshit", "BigShit", "fuckyou", "FuckYou",
     "f4ggot", "ass", "ass69", "xX_bitch_Xx", "b1tch", "a55"],
)
def test_profanity_is_rejected(username: str):
    assert is_profane(username)
    with pytest.raises(UsernameNotAllowedError):
        validate_username(username)


@pytest.mark.parametrize(
    "username",
    ["class", "assassin", "grass_hopper", "analyst", "grape", "spicy",
     "despicable", "Dickens", "peacock", "therapist", "Hancock", "cool_ryan"],
)
def test_innocent_words_containing_short_profanity_are_allowed(username: str):
    assert not is_profane(username)
