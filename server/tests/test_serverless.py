"""Tests for serverless.py, with saved Passio responses instead of the network."""

from pathlib import Path

import pytest

from bobcatch import serverless
from bobcatch.passio import PassioError, SavedPassio

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


class CountingSource(SavedPassio):
    calls = 0

    async def fetch_routes_and_stops(self):
        CountingSource.calls += 1
        return await super().fetch_routes_and_stops()


@pytest.fixture(autouse=True)
def saved_passio(monkeypatch):
    CountingSource.calls = 0
    monkeypatch.setattr(serverless, "_static_memory", {"data": None, "fetched_at": 0.0})
    monkeypatch.setattr(serverless, "PassioClient", lambda: CountingSource(SAMPLES))


def test_live_is_cached_by_the_cdn_for_a_few_seconds():
    status, body, cdn_cache = serverless.live_response()
    assert status == 200
    assert set(body) == {"vehicles", "arrivals", "updatedAt"}
    assert cdn_cache.startswith(f"max-age={serverless.LIVE_CDN_SECONDS}")


def test_routes_are_kept_in_memory_between_requests():
    serverless.live_response()
    serverless.live_response()
    serverless.static_response()
    assert CountingSource.calls == 1


def test_a_passio_failure_is_not_cached(monkeypatch):
    class Broken(SavedPassio):
        async def fetch_routes_and_stops(self):
            raise PassioError("down")

    monkeypatch.setattr(serverless, "PassioClient", lambda: Broken(SAMPLES))
    status, body, cdn_cache = serverless.static_response()
    assert status == 503
    assert cdn_cache is None
