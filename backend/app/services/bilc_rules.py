"""Pure rules for BYOM: model size classes (PROTOCOL.md, "BYOM arena") and BILC version checks."""

import re
from typing import Any, Literal

SizeClass = Literal["small", "medium", "large"]
# Ordered smallest first; matchmaking widens to the neighbors in this order.
SIZE_CLASSES: tuple[SizeClass, ...] = ("small", "medium", "large")

SMALL_BELOW = 8e9      # under 8B parameters
LARGE_ABOVE = 30e9     # over 30B parameters

_PARAMETER_SIZE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([KMBT])\s*$", re.IGNORECASE)
_SCALE = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}
_VERSION = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


def parameter_count(model: dict[str, Any] | None) -> float | None:
    """Parameters from `HELLO.model.metadata.parameter_size` (Ollama's format, e.g. "8.0B"), if reported."""
    metadata = (model or {}).get("metadata")
    size = metadata.get("parameter_size") if isinstance(metadata, dict) else None
    match = _PARAMETER_SIZE.match(size) if isinstance(size, str) else None
    if match is None:
        return None
    return float(match.group(1)) * _SCALE[match.group(2).upper()]


def size_class(model: dict[str, Any] | None) -> SizeClass:
    """The device's class. The size is self-reported; an unknown size counts as large, since a
    device can't gain anything by hiding a big model among small ones that way."""
    count = parameter_count(model)
    if count is None or count > LARGE_ABOVE:
        return "large"
    return "small" if count < SMALL_BELOW else "medium"


def class_distance(a: SizeClass, b: SizeClass) -> int:
    return abs(SIZE_CLASSES.index(a) - SIZE_CLASSES.index(b))


def parse_version(version: str) -> tuple[int, int, int] | None:
    match = _VERSION.match(version.strip())
    return tuple(int(part) for part in match.groups()) if match else None  # type: ignore[return-value]


def is_outdated(client_version: str, min_supported: str, allow_dev: bool) -> bool:
    """Whether a client must update. Unversioned builds ("dev") pass only when `allow_dev`."""
    client, minimum = parse_version(client_version), parse_version(min_supported)
    if minimum is None:
        raise ValueError(f"BILC_MIN_SUPPORTED_VERSION {min_supported!r} isn't MAJOR.MINOR.PATCH")
    if client is None:
        return not (allow_dev and client_version == "dev")
    return client < minimum
