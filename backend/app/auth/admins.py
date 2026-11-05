"""Who may use the admin routes (PROTOCOL.md, "REST — admin").

The list is fixed in code on purpose: granting admin takes a reviewed commit, never a request.
Tags never change once set (BACKEND.md, "Tags and usernames"), so a tag names one account for good.
Compared ignoring case, like tag uniqueness. No imports, so schemas can use it without cycles.
"""

ADMIN_TAGS: frozenset[str] = frozenset({
    "Jacky720",
    # Admins may add more here.
})

_ADMIN_TAGS_LOWER = frozenset(tag.lower() for tag in ADMIN_TAGS)


def is_admin_tag(tag: str | None) -> bool:
    return tag is not None and tag.lower() in _ADMIN_TAGS_LOWER
