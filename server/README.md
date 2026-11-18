# Bobcatch server

Polls Passio GO for NYU bus data and serves it to the web app. Clients only
talk to this server, never to Passio.

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

## Files

- `bobcatch/passio.py`: the requests to Passio (or saved responses)
- `bobcatch/convert.py`: Passio's format to ours
- `bobcatch/poller.py`: when to poll, caching, backoff
- `bobcatch/app.py`: the HTTP endpoints
