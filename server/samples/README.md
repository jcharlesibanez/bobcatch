# Saved Passio responses

Raw responses from Passio GO for NYU (system 1007), saved on 2026-11-18 around
12:20 AM New York time. Used by `BOBCATCH_SOURCE=saved` and by the tests.

- `routes_and_stops.json`: `getStops` (every NYU route, stop and route path)
- `vehicles.json`: `getBuses`
- `etas.json`: `eta` for every campus-route stop

They were saved after midnight, so no campus buses were running: the saved
buses are NYU Langone shuttles (filtered out) and there are no arrival times.
To refresh them, call the endpoints in `bobcatch/passio.py` and save the
responses here. Check them for personal data first, such as driver names.
