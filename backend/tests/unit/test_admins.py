from app.auth.admins import ADMIN_TAGS, is_admin_tag
from app.services.tags import TAG_PATTERN


def test_admin_tags_are_valid_tags():
    # A malformed entry could never match an account, so it would silently grant nobody.
    assert ADMIN_TAGS
    assert all(TAG_PATTERN.fullmatch(tag) for tag in ADMIN_TAGS)
    assert len({tag.lower() for tag in ADMIN_TAGS}) == len(ADMIN_TAGS)


def test_is_admin_tag_ignores_case_and_rejects_untagged():
    tag = next(iter(ADMIN_TAGS))
    assert is_admin_tag(tag.upper()) and is_admin_tag(tag.lower())
    assert not is_admin_tag(None)
    assert not is_admin_tag("")
