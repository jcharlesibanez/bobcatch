"""Where Bobcatch gets NYU bus data from: Passio GO.

Passio has no public, documented API. These are the same requests the Passio GO
website and app make. The endpoints for routes, stops and buses come from the
unofficial `passiogo` package (https://github.com/athuler/PassioGo); the
arrival-time endpoint was found by watching the website. Any of them can change
without warning, which is why this file only fetches raw responses and
`convert.py` does the interpreting.

Two sources share one interface, so the poller doesn't care which it has:
- `PassioClient` asks Passio over the internet.
- `SavedPassio` reads responses saved earlier, for working offline.
"""

import json
from pathlib import Path

import httpx

BASE_URL = "https://passiogo.com/mapGetData.php"
NYU_SYSTEM_ID = "1007"


class PassioError(Exception):
    """Passio could not be reached, or sent back something we can't read."""


class PassioClient:
    def __init__(self, system_id=NYU_SYSTEM_ID, timeout_seconds=10):
        self.system_id = system_id
        self.http = httpx.AsyncClient(
            timeout=timeout_seconds,
            headers={"User-Agent": "Bobcatch (open-source student bus tracker)"},
        )

    async def close(self):
        await self.http.aclose()

    async def fetch_routes_and_stops(self):
        """Every route, stop, and the road each route drives. Changes rarely."""
        return await self._request("POST", {"getStops": 2}, body={"s0": self.system_id, "sA": 1})

    async def fetch_vehicles(self):
        """Where every bus in the system is right now."""
        return await self._request("POST", {"getBuses": 2}, body={"s0": self.system_id, "sA": 1})

    async def fetch_etas(self, stop_ids):
        """Passio's predicted arrivals at the given stops, all in one request."""
        params = {
            "eta": 3,
            "deviceId": 0,
            "stopIds": ",".join(stop_ids),
            "userId": self.system_id,
        }
        return await self._request("GET", params)

    async def _request(self, method, params, body=None):
        try:
            response = await self.http.request(method, BASE_URL, params=params, json=body)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            # ValueError: the response wasn't JSON (Passio sometimes sends HTML errors).
            raise PassioError(f"{method} {params}: {error}") from error
        if isinstance(data, dict) and data.get("error"):
            raise PassioError(f"Passio returned an error: {data['error']}")
        return data


class SavedPassio:
    """Serves responses saved in a folder instead of calling Passio.

    Arrivals are stored as absolute times, so saved ones are in the past; this
    source is for building and testing, not for real arrival times.
    """

    def __init__(self, folder):
        self.folder = Path(folder)

    async def close(self):
        pass

    async def fetch_routes_and_stops(self):
        return self._read("routes_and_stops.json")

    async def fetch_vehicles(self):
        return self._read("vehicles.json")

    async def fetch_etas(self, stop_ids):
        return self._read("etas.json")

    def _read(self, name):
        try:
            return json.loads((self.folder / name).read_text())
        except (OSError, ValueError) as error:
            raise PassioError(f"Could not read saved response {name}: {error}") from error
