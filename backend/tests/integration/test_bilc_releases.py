"""`GET /v1/bilc/releases/latest`: what `bilc run` checks for updates."""
from unittest.mock import AsyncMock

import httpx
import respx

from app.config import settings
from app.main import app
from app.schemas import BilcReleaseAsset
from app.services.bilc_releases import BilcReleases, fetch_latest

LATEST = "/v1/bilc/releases/latest"
CHECKSUMS_URL = "https://downloads.example/checksums.txt"
GITHUB_RELEASE = {
    "tag_name": "bilc/v0.2.0",
    "assets": [
        {"name": "bilc_linux_amd64.tar.gz", "browser_download_url": "https://downloads.example/linux.tar.gz"},
        {"name": "bilc_darwin_arm64.tar.gz", "browser_download_url": "https://downloads.example/mac.tar.gz"},
        {"name": "bilc_windows_amd64.zip", "browser_download_url": "https://downloads.example/win.zip"},
        {"name": "bilc_linux_arm64.tar.gz", "browser_download_url": "https://downloads.example/no-checksum.tar.gz"},
        {"name": "install.sh", "browser_download_url": "https://downloads.example/install.sh"},
        {"name": "checksums.txt", "browser_download_url": CHECKSUMS_URL},
    ],
}
CHECKSUMS = "aaa  bilc_linux_amd64.tar.gz\nbbb  bilc_darwin_arm64.tar.gz\n\nccc  bilc_windows_amd64.zip\n"


async def test_reports_the_latest_release_without_signing_in(client):
    assets = [BilcReleaseAsset(platform="linux", arch="amd64", url="https://downloads.example/a", sha256="aaa")]
    app.state.bilc_releases = BilcReleases(fetch=AsyncMock(return_value=("0.2.0", assets)))
    response = await client.get(LATEST)
    assert response.status_code == 200
    assert response.json() == {
        "version": "0.2.0",
        "min_supported_version": settings.bilc_min_supported_version,
        "protocol_version": 1,
        "assets": [{"platform": "linux", "arch": "amd64", "url": "https://downloads.example/a", "sha256": "aaa"}],
    }


async def test_no_release_yet_still_gives_the_minimum(client):
    body = (await client.get(LATEST)).json()
    assert body["version"] is None and body["assets"] == []
    assert body["min_supported_version"] == settings.bilc_min_supported_version


async def test_route_is_rate_limited_per_ip(client):
    statuses = [(await client.get(LATEST)).status_code for _ in range(21)]
    assert statuses == [200] * 20 + [429]


@respx.mock
async def test_fetch_reads_version_assets_and_checksums():
    respx.get(settings.bilc_releases_url).mock(return_value=httpx.Response(200, json=GITHUB_RELEASE))
    respx.get(CHECKSUMS_URL).mock(return_value=httpx.Response(200, text=CHECKSUMS))
    version, assets = await fetch_latest()
    assert version == "0.2.0"
    assert {(a.platform, a.arch, a.sha256) for a in assets} == {
        ("linux", "amd64", "aaa"), ("mac", "arm64", "bbb"), ("win", "amd64", "ccc"),
    }


@respx.mock
async def test_fetch_with_nothing_published():
    respx.get(settings.bilc_releases_url).mock(return_value=httpx.Response(404, json={"message": "Not Found"}))
    assert await fetch_latest() is None


@respx.mock
async def test_fetch_ignores_a_release_that_isnt_bilcs():
    respx.get(settings.bilc_releases_url).mock(
        return_value=httpx.Response(200, json={"tag_name": "backend/v1.0.0", "assets": []}))
    assert await fetch_latest() is None


class Clock:
    now = 0.0

    def __call__(self) -> float:
        return self.now


async def test_answer_is_cached_until_it_expires():
    clock = Clock()
    fetch = AsyncMock(return_value=("0.2.0", []))
    releases = BilcReleases(fetch=fetch, clock=clock)
    await releases.describe(1)
    clock.now = releases.CACHE_SECONDS - 1
    await releases.describe(1)
    assert fetch.await_count == 1
    clock.now = releases.CACHE_SECONDS
    await releases.describe(1)
    assert fetch.await_count == 2


async def test_github_failures_keep_the_last_answer_and_arent_retried_at_once():
    clock = Clock()
    fetch = AsyncMock(side_effect=[("0.2.0", []), httpx.ConnectError("down"), ValueError("bad"), ("0.3.0", [])])
    releases = BilcReleases(fetch=fetch, clock=clock)
    assert (await releases.describe(1)).version == "0.2.0"
    clock.now = releases.CACHE_SECONDS
    assert (await releases.describe(1)).version == "0.2.0"
    assert (await releases.describe(1)).version == "0.2.0"
    assert fetch.await_count == 2
    clock.now = 2 * releases.CACHE_SECONDS
    assert (await releases.describe(1)).version == "0.2.0"
    clock.now = 3 * releases.CACHE_SECONDS
    assert (await releases.describe(1)).version == "0.3.0"
