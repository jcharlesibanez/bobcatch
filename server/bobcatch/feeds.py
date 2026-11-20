"""One fetch of each feed: ask Passio, convert, return our shapes.

Both ways of running Bobcatch use these:
- the long-running server (poller.py) calls them on a timer, and
- the Vercel Functions (serverless.py) call them when a request comes in.
Keeping the fetching here means the two can't drift apart.
"""

import asyncio

from . import convert
from .passio import PassioError


async def fetch_static(source):
    """Routes and stops: {"routes": [...], "stops": [...]}."""
    raw = await source.fetch_routes_and_stops()
    routes, stops = convert.convert_routes_and_stops(raw)
    if not routes:
        raise PassioError("Passio returned no campus routes")
    return {"routes": routes, "stops": stops}


async def fetch_live(source, routes):
    """Bus positions and arrivals for these routes: {"vehicles": [...], "arrivals": {...}}."""
    route_ids = {route["id"] for route in routes}
    stop_ids = sorted({stop_id for route in routes for stop_id in route["stopIds"]})
    # Ask for both at once rather than one after the other.
    raw_vehicles, raw_etas = await asyncio.gather(
        source.fetch_vehicles(),
        source.fetch_etas(stop_ids),
    )
    return {
        "vehicles": convert.convert_vehicles(raw_vehicles, route_ids),
        "arrivals": convert.convert_etas(raw_etas, route_ids),
    }
