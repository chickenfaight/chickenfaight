import pytest

from app.services.exceptions import TagInvalidError, TagNotAllowedError
from app.services.tags import is_profane, validate_tag


@pytest.mark.parametrize("tag", ["abc", "Ryan_72", "a" * 24, "___", "UPPER", "123"])
def test_valid_formats_are_accepted(tag: str):
    assert validate_tag(tag) == tag


@pytest.mark.parametrize(
    "tag",
    ["", "ab", "a" * 25, "has space", " padded", "padded ", "dash-ed", "dot.ted",
     "émile", "emoji🐔", "semi;colon", "new\nline", "abc\n"],
)
def test_invalid_formats_are_rejected(tag: str):
    with pytest.raises(TagInvalidError):
        validate_tag(tag)


@pytest.mark.parametrize(
    "tag",
    ["shit", "sh1t", "big_shit", "bigshit", "BigShit", "fuckyou", "FuckYou",
     "f4ggot", "ass", "ass69", "xX_bitch_Xx", "b1tch", "a55"],
)
def test_profanity_is_rejected(tag: str):
    assert is_profane(tag)
    with pytest.raises(TagNotAllowedError):
        validate_tag(tag)


@pytest.mark.parametrize(
    "tag",
    ["class", "assassin", "grass_hopper", "analyst", "grape", "spicy",
     "despicable", "Dickens", "peacock", "therapist", "Hancock", "cool_ryan"],
)
def test_innocent_words_containing_short_profanity_are_allowed(tag: str):
    assert not is_profane(tag)
