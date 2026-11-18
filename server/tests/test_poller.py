"""Tests for poller.py. They use SavedPassio or a fake source, never the network."""

import asyncio
from pathlib import Path

import pytest

from bobcatch.passio import PassioError, SavedPassio
from bobcatch.poller import RETRY_MAX, Poller, retry_delay

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


def test_retry_delay_doubles_then_caps():
    assert [retry_delay(n) for n in (1, 2, 3)] == [10, 20, 40]
    assert retry_delay(50) == RETRY_MAX


def test_refresh_from_saved_responses():
    async def run():
        poller = Poller(SavedPassio(SAMPLES))
        await poller.refresh_static()
        await poller.refresh_live()
        return poller

    poller = asyncio.run(run())
    assert {route["shortName"] for route in poller.static.data["routes"]} >= {"A", "B", "C"}
    assert set(poller.live.data) == {"vehicles", "arrivals"}
    assert poller.live.updated_at is not None


class FlakySource(SavedPassio):
    """Saved responses, except buses fail until told otherwise."""

    broken = True

    async def fetch_vehicles(self):
        if self.broken:
            raise PassioError("Passio is down")
        return await super().fetch_vehicles()


def test_a_failure_keeps_the_last_good_data_and_backs_off():
    async def run():
        source = FlakySource(SAMPLES)
        poller = Poller(source)
        await poller.refresh_static()
        source.broken = False
        assert await poller.attempt(poller.live, poller.refresh_live, 10) == 10
        good = poller.live.data

        source.broken = True
        delays = [await poller.attempt(poller.live, poller.refresh_live, 10) for _ in range(3)]
        return poller, good, delays

    poller, good, delays = asyncio.run(run())
    assert poller.live.data is good
    assert poller.live.failures == 3
    assert delays == [10, 20, 40]
