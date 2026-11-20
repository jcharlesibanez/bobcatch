"""The Bobcatch web server: serves what the poller has collected.

Run it from the server/ folder:
    uvicorn bobcatch.app:app --reload --port 8000

Set BOBCATCH_SOURCE=saved to serve the responses in samples/ instead of
calling Passio (for working offline).

Endpoints:
    GET /api/static  routes and stops            (changes rarely)
    GET /api/live    bus positions and arrivals  (changes every few seconds)
    GET /api/health  how each feed is doing
Each data response carries `updatedAt` (Unix seconds) so the app can show how
old the data is, even when Passio is down and we're serving the last good copy.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .passio import PassioClient, SavedPassio
from .poller import Poller

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # otherwise it logs every request to Passio

SAMPLES_FOLDER = Path(__file__).resolve().parent.parent / "samples"


def make_source():
    if os.environ.get("BOBCATCH_SOURCE") == "saved":
        return SavedPassio(SAMPLES_FOLDER)
    return PassioClient()


@asynccontextmanager
async def lifespan(app):
    # Start polling when the server starts, and stop cleanly when it stops.
    app.state.poller = Poller(make_source())
    app.state.poller.start()
    yield
    await app.state.poller.stop()


app = FastAPI(title="Bobcatch", lifespan=lifespan)


def not_ready(feed):
    return JSONResponse(
        {"error": "No data yet. The server is still contacting Passio.", **feed.status()},
        status_code=503,
        headers={"Retry-After": "10"},
    )


@app.get("/api/static")
def get_static():
    feed = app.state.poller.static
    if feed.data is None:
        return not_ready(feed)
    return JSONResponse(
        {**feed.data, "updatedAt": feed.updated_at},
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/api/live")
def get_live():
    poller = app.state.poller
    poller.client_asked()
    feed = poller.live
    if feed.data is None:
        return not_ready(feed)
    return JSONResponse(
        {**feed.data, "updatedAt": feed.updated_at},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/health")
def get_health():
    poller = app.state.poller
    return {
        "source": type(poller.source).__name__,
        "static": poller.static.status(),
        "live": poller.live.status(),
        "lastClientRequest": poller.last_client_request or None,
    }
