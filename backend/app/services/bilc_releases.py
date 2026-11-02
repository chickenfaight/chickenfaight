"""The latest BILC release, read from GitHub Releases (BILC.md, "Updates") and cached in memory."""

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable

import httpx

from app.config import settings
from app.schemas import BilcRelease, BilcReleaseAsset

logger = logging.getLogger(__name__)

# Only BILC publishes GitHub Releases in this repo, so "latest" is BILC's; the tag is checked anyway.
_TAG = re.compile(r"^bilc/v(\d+\.\d+\.\d+)$")
_ASSET = re.compile(r"^bilc_(darwin|linux|windows)_(amd64|arm64)\.(?:tar\.gz|zip)$")
_PLATFORMS = {"darwin": "mac", "linux": "linux", "windows": "win"}
FETCH_TIMEOUT = 4  # seconds in total; BILC gives up on the whole check after 5


async def fetch_latest() -> tuple[str, list[BilcReleaseAsset]] | None:
    """The latest release's version and assets, or None if nothing is published. Raises if GitHub
    can't be read."""
    async with asyncio.timeout(FETCH_TIMEOUT), httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(settings.bilc_releases_url, headers={"Accept": "application/vnd.github+json"})
        if response.status_code == 404:
            return None
        response.raise_for_status()
        release = response.json()
        tag = _TAG.match(release["tag_name"])
        if tag is None:
            return None
        urls = {asset["name"]: asset["browser_download_url"] for asset in release["assets"]}
        if "checksums.txt" not in urls:
            raise ValueError("Release has no checksums.txt")
        checksums = await client.get(urls["checksums.txt"])
        checksums.raise_for_status()
    hashes = {name: digest for digest, name in (line.split() for line in checksums.text.splitlines() if line.strip())}
    assets = []
    for name, url in urls.items():
        if (match := _ASSET.match(name)) and name in hashes:
            assets.append(BilcReleaseAsset(platform=_PLATFORMS[match[1]], arch=match[2], url=url, sha256=hashes[name]))
    return tag[1], assets


class BilcReleases:
    """Keeps GitHub's answer for `CACHE_SECONDS`, since the route is public and GitHub's limit for
    anonymous calls is low. If GitHub can't be read, the last answer stands until the next try."""

    CACHE_SECONDS = 600

    def __init__(
        self,
        fetch: Callable[[], Awaitable[tuple[str, list[BilcReleaseAsset]] | None]] = fetch_latest,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.fetch = fetch
        self.clock = clock
        self.lock = asyncio.Lock()
        self.fetched_at: float | None = None
        self.latest: tuple[str, list[BilcReleaseAsset]] | None = None

    async def describe(self, protocol_version: int) -> BilcRelease:
        async with self.lock:
            if self.fetched_at is None or self.clock() - self.fetched_at >= self.CACHE_SECONDS:
                try:
                    self.latest = await self.fetch()
                except (httpx.HTTPError, TimeoutError, ValueError, KeyError, TypeError) as exc:
                    logger.warning("Couldn't read the latest BILC release: %r", exc)
                self.fetched_at = self.clock()
        version, assets = self.latest or (None, [])
        return BilcRelease(
            version=version,
            min_supported_version=settings.bilc_min_supported_version,
            protocol_version=protocol_version,
            assets=assets,
        )
