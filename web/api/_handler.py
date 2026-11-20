"""Shared plumbing for the Python functions in this folder.

Files and folders here starting with "_" are helpers, not endpoints. The real
logic lives in server/bobcatch (linked as _lib/bobcatch); see serverless.py.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "_lib"))


class JsonHandler(BaseHTTPRequestHandler):
    """Answers GET with the (status, body, cdn_cache) that `respond()` returns.

    Each endpoint file defines `class handler(JsonHandler)` with its own
    `respond`. Vercel looks for a top-level `class handler` in the file's text
    to decide that the file is a function, so it must be written out that way.
    """

    @staticmethod
    def respond():
        raise NotImplementedError

    def do_GET(self):
        status, body, cdn_cache = self.respond()
        payload = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        # Browsers always ask again; Vercel's CDN does the caching.
        self.send_header("Cache-Control", "no-store")
        if cdn_cache:
            self.send_header("Vercel-CDN-Cache-Control", cdn_cache)
        self.end_headers()
        self.wfile.write(payload)
