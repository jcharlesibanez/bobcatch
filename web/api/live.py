"""GET /api/live: bus positions and arrivals. Runs on Vercel; see server/bobcatch/serverless.py."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _handler import make_handler  # noqa: E402
from bobcatch.serverless import live_response  # noqa: E402

handler = make_handler(live_response)
