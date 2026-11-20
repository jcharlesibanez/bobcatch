"""Bobcatch as Vercel Functions: fetch from Passio when asked, let the CDN cache.

The long-running server (app.py + poller.py) polls Passio on a timer and keeps
the latest data in memory. Vercel Functions can't do that: they start when a
request arrives and may be stopped as soon as they answer. So here:

- Each request that reaches a function asks Passio directly.
- The response tells Vercel's CDN to keep a copy for a few seconds (see
  LIVE_CDN_CACHE). Requests during that time get the copy and never reach the
  function, so Passio sees about one request per LIVE_CDN_SECONDS per CDN
  region, however many students are looking, and none when nobody is.
- Routes and stops are also kept in memory between requests, for as long as
  Vercel keeps this function instance warm. That's a bonus, not a guarantee.

web/api/static.py and web/api/live.py call `static_response` and `live_response`.
"""

import asyncio
import time

from . import feeds
from .passio import PassioClient, PassioError

LIVE_CDN_SECONDS = 10
STATIC_CDN_SECONDS = 6 * 60 * 60
STATIC_MEMORY_SECONDS = 6 * 60 * 60

# Vercel-CDN-Cache-Control is read only by Vercel's CDN. stale-while-revalidate
# lets the CDN answer instantly with the previous copy while it fetches a new
# one in the background.
LIVE_CDN_CACHE = f"max-age={LIVE_CDN_SECONDS}, stale-while-revalidate=20"
STATIC_CDN_CACHE = f"max-age={STATIC_CDN_SECONDS}, stale-while-revalidate=86400"

_static_memory = {"data": None, "fetched_at": 0.0}


async def _static(source):
    """Routes and stops, from memory if this instance fetched them recently."""
    age = time.time() - _static_memory["fetched_at"]
    if _static_memory["data"] is None or age > STATIC_MEMORY_SECONDS:
        _static_memory["data"] = await feeds.fetch_static(source)
        _static_memory["fetched_at"] = time.time()
    return _static_memory["data"]


async def _with_client(work):
    source = PassioClient()
    try:
        return await work(source)
    finally:
        await source.close()


def static_response():
    """(status, body, cdn_cache) for GET /api/static."""
    return _respond(lambda source: _static(source), STATIC_CDN_CACHE)


def live_response():
    """(status, body, cdn_cache) for GET /api/live."""

    async def work(source):
        static = await _static(source)
        return await feeds.fetch_live(source, static["routes"])

    return _respond(work, LIVE_CDN_CACHE)


def _respond(work, cdn_cache):
    try:
        data = asyncio.run(_with_client(work))
    except PassioError as error:
        # Not cached, so the next request tries Passio again.
        return 503, {"error": "Could not reach Passio right now.", "detail": str(error)}, None
    return 200, {**data, "updatedAt": time.time()}, cdn_cache
