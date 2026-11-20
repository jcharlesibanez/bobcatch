# Bobcatch server

Gets NYU bus data from Passio GO and serves it to the web app. Clients only
talk to Bobcatch, never to Passio.

The same Python package runs two ways:

| | Local development | Deployed (Vercel) |
|---|---|---|
| Entry point | `bobcatch/app.py` (FastAPI) | `web/api/live.py`, `web/api/static.py` |
| When Passio is asked | On a timer (`poller.py`) | When a request reaches the function (`serverless.py`) |
| What stops Passio being asked too often | The poller's fixed interval | Vercel's CDN keeps each answer for 10 s (live) or 6 h (routes and stops) |
| If Passio fails | Keeps serving the last good data, backs off | Returns 503 (not cached); the CDN may serve its previous copy for up to 20 s |

Both use `bobcatch/feeds.py` to fetch and `bobcatch/convert.py` to convert, so
they always return the same shapes.

## Run it

Needs Python 3.11 or newer. From this folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn bobcatch.app:app --reload --port 8000
```

Then start the web app (`npm run dev` in `web/`). Vite forwards `/api` to port
8000, so the app shows live data and the "Demo data" badge disappears.

No network, or Passio is down? Serve saved responses instead:

```bash
BOBCATCH_SOURCE=saved uvicorn bobcatch.app:app --reload --port 8000
```

Run the tests with `pytest`.

## Endpoints

| Path | What | Refreshed from Passio |
|---|---|---|
| `/api/static` | `routes`, `stops` | every 6 hours |
| `/api/live` | `vehicles`, `arrivals` | every 10 seconds, only while someone asked in the last 5 minutes |
| `/api/health` | how each feed is doing | |

Data responses include `updatedAt` (Unix seconds). If Passio fails, the server
keeps serving the last good data and retries after 10 s, 20 s, 40 s, … up to
5 minutes.

## Deployment

Vercel builds the web app from `web/` and turns `web/api/live.py` and
`web/api/static.py` into Python functions. Its install step (see
`web/vercel.json`) copies this `bobcatch` package into `web/api/_lib/`, because
a function can only bundle files inside `web/`. Don't edit that copy; it's
gitignored and remade on every deploy.

Two Vercel rules worth knowing, both learned the hard way:
- A Python file is only treated as a function if it defines a top-level
  `class handler` written out in the file.
- A symlink is bundled as a link, not as the files it points to.

## Files

- `bobcatch/passio.py`: the requests to Passio (or saved responses)
- `bobcatch/convert.py`: Passio's format to ours
- `bobcatch/poller.py`: when to poll, caching, backoff
- `bobcatch/feeds.py`: one fetch of each feed, shared by both entry points
- `bobcatch/app.py`: the HTTP endpoints for local development
- `bobcatch/serverless.py`: the same endpoints as Vercel Functions
