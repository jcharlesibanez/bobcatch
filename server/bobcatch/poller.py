"""Polls Passio in the background and keeps the latest good data in memory.

Clients never trigger a request to Passio. They read whatever the poller last
fetched, so a thousand students cost Passio the same as one.

Two feeds, polled at different rates because they change at different rates:
- static: routes and stops. Every few hours.
- live:   bus positions and arrival times. Every several seconds, but only
          while someone has asked for data recently.

On an error a feed keeps its last good data and retries with exponential
backoff, so a Passio outage doesn't turn into us hammering Passio.
"""

import asyncio
import logging
import time

from . import convert
from .passio import PassioError

log = logging.getLogger("bobcatch.poller")

STATIC_INTERVAL = 6 * 60 * 60  # seconds between route/stop refreshes
LIVE_INTERVAL = 10  # seconds between bus/arrival refreshes
IDLE_AFTER = 5 * 60  # stop live polling when no one has asked for this long
RETRY_FIRST = 10  # seconds before the first retry after an error (not faster than LIVE_INTERVAL)
RETRY_MAX = 5 * 60  # never wait longer than this between retries


def retry_delay(failures):
    """Seconds to wait after `failures` errors in a row: 10, 20, 40, ... up to RETRY_MAX."""
    return min(RETRY_FIRST * 2 ** (failures - 1), RETRY_MAX)


class Feed:
    """The latest good data from one feed, and how the last attempts went."""

    def __init__(self, name):
        self.name = name
        self.data = None  # replaced as a whole on success, never edited in place
        self.updated_at = None  # Unix time of the last success
        self.failures = 0  # errors in a row since the last success
        self.last_error = None

    def succeeded(self, data):
        self.data = data
        self.updated_at = time.time()
        if self.failures:
            log.info("%s feed recovered after %d failed attempts", self.name, self.failures)
        self.failures = 0
        self.last_error = None

    def failed(self, error):
        self.failures += 1
        self.last_error = str(error)
        log.warning("%s feed failed (%d in a row): %s", self.name, self.failures, error)

    def status(self):
        return {
            "updatedAt": self.updated_at,
            "failures": self.failures,
            "lastError": self.last_error,
        }


class Poller:
    def __init__(self, source):
        self.source = source  # a PassioClient or SavedPassio
        self.static = Feed("static")  # data: {"routes": [...], "stops": [...]}
        self.live = Feed("live")  # data: {"vehicles": [...], "arrivals": {...}}
        self.last_client_request = 0.0
        self._static_ready = asyncio.Event()
        self._wake = asyncio.Event()
        self._tasks = []

    # --- Called by the web server -------------------------------------------

    def start(self):
        self._tasks = [
            asyncio.create_task(self._loop(self.static, self.refresh_static, STATIC_INTERVAL)),
            asyncio.create_task(self._loop(self.live, self.refresh_live, LIVE_INTERVAL, wait_for_clients=True)),
        ]

    async def stop(self):
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.source.close()

    def client_asked(self):
        """Note that someone wants data, and wake the live feed if it was idle."""
        self.last_client_request = time.time()
        self._wake.set()

    # --- One fetch each; the loops below call these -------------------------

    async def refresh_static(self):
        raw = await self.source.fetch_routes_and_stops()
        routes, stops = convert.convert_routes_and_stops(raw)
        if not routes:
            raise PassioError("Passio returned no campus routes")
        self.static.succeeded({"routes": routes, "stops": stops})
        self._static_ready.set()

    async def refresh_live(self):
        routes = self.static.data["routes"]
        route_ids = {route["id"] for route in routes}
        stop_ids = sorted({stop_id for route in routes for stop_id in route["stopIds"]})
        # Ask for both at once rather than one after the other.
        raw_vehicles, raw_etas = await asyncio.gather(
            self.source.fetch_vehicles(),
            self.source.fetch_etas(stop_ids),
        )
        self.live.succeeded({
            "vehicles": convert.convert_vehicles(raw_vehicles, route_ids),
            "arrivals": convert.convert_etas(raw_etas, route_ids),
        })

    # --- The loops ----------------------------------------------------------

    async def _loop(self, feed, refresh, interval, wait_for_clients=False):
        if wait_for_clients:
            await self._static_ready.wait()  # live data is meaningless without routes
        while True:
            if wait_for_clients and self._clients_idle():
                log.info("No one is looking; pausing the %s feed", feed.name)
                self._wake.clear()
                await self._wake.wait()
                log.info("Someone is looking; resuming the %s feed", feed.name)
            await asyncio.sleep(await self.attempt(feed, refresh, interval))

    async def attempt(self, feed, refresh, interval):
        """Run one refresh, record how it went, and return seconds until the next."""
        try:
            await refresh()
        except PassioError as error:
            feed.failed(error)
        except Exception as error:  # a bug in convert.py, or Passio changed its format
            log.exception("Unexpected error in the %s feed", feed.name)
            feed.failed(error)
        return retry_delay(feed.failures) if feed.failures else interval

    def _clients_idle(self):
        return time.time() - self.last_client_request > IDLE_AFTER
