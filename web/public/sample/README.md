# Sample data

The app falls back to these files when the Bobcatch server (`server/`) can't be reached, for example on a deployed copy with no server.

**Real (saved once from Passio GO on 2026-11-16):**
- `stops.json`: stop names and locations
- `routes.json`: route names, colors, stop order and the path each route drives

These are a snapshot. They go stale when NYU changes its routes; the server always has the current ones.

**Made up:**
- `vehicles.json`: bus positions
- `arrivals.json`: arrival times

The app shows a "Demo" badge whenever it is reading from here.
