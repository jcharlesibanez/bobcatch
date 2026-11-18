"""Turn Passio's raw responses into the shapes Bobcatch serves.

Everything here is a pure function: data in, data out, no network and no clock.
That makes it easy to test with saved responses (see tests/test_convert.py).

The shapes we serve (the web app's data.js reads these):
    route:    {id, shortName, name, color, stopIds: [stopId], path: [[[lat, lon]]]}
    stop:     {id, name, lat, lon}
    vehicle:  {id, routeId, lat, lon}
    arrivals: {stopId: [{routeId, vehicleId, arrivesAt}]}   arrivesAt = Unix seconds
"""

import re

# Passio lists every NYU service in one system: the lettered campus routes,
# plus NYU Langone shuttles and a ferry. For now Bobcatch shows only the
# lettered routes (A, B, C, ...). Matching the short name, rather than a list
# of ids, keeps working if NYU recreates a route under a new id.
CAMPUS_ROUTE_NAME = re.compile(r"^[A-Z]$")


def campus_route_ids(raw_routes_and_stops):
    """Ids of the routes Bobcatch shows."""
    short_names = raw_routes_and_stops.get("routeShortNames") or {}
    return {
        route_id
        for route_id in raw_routes_and_stops["routes"]
        if CAMPUS_ROUTE_NAME.match(short_names.get(route_id) or "")
    }


def simplify_line(points):
    """Passio's [{lat, lng}] strings -> [[lat, lon]] numbers, rounded to 5 decimal
    places (about 1 m) with repeated points dropped. Paths are most of the
    download, so this matters on phones."""
    line = []
    for point in points:
        lat_lon = [round(float(point["lat"]), 5), round(float(point["lng"]), 5)]
        if not line or line[-1] != lat_lon:
            line.append(lat_lon)
    return line


def convert_routes_and_stops(raw):
    """Passio's getStops response -> (routes, stops) for the campus routes."""
    keep = campus_route_ids(raw)
    short_names = raw.get("routeShortNames") or {}
    route_points = raw.get("routePoints") or {}

    routes = []
    for route_id, entry in raw["routes"].items():
        if route_id not in keep:
            continue
        # entry looks like: [name, color, [position, stopId, _], [position, stopId, _], ...]
        name, color, *stop_entries = entry
        stop_entries.sort(key=lambda stop: int(stop[0]))
        routes.append({
            "id": route_id,
            "shortName": short_names[route_id],
            "name": name,
            "color": color,
            "stopIds": [str(stop[1]) for stop in stop_entries],
            "path": [simplify_line(line) for line in route_points.get(route_id, [])],
        })
    routes.sort(key=lambda route: route["shortName"])

    # Passio repeats a stop once for every route that serves it; keep one copy.
    used_stop_ids = {stop_id for route in routes for stop_id in route["stopIds"]}
    stops = {}
    for stop in raw["stops"].values():
        stop_id = str(stop["id"])
        if stop_id in used_stop_ids and stop_id not in stops:
            stops[stop_id] = {
                "id": stop_id,
                "name": stop["name"].strip(),
                # 6 decimal places is about 10 cm, plenty for a bus stop.
                "lat": round(float(stop["latitude"]), 6),
                "lon": round(float(stop["longitude"]), 6),
            }
    return routes, list(stops.values())


def convert_vehicles(raw, route_ids):
    """Passio's getBuses response -> buses in service on the given routes."""
    vehicles = []
    for device_id, reports in (raw.get("buses") or {}).items():
        if device_id == "-1" or not reports:  # "-1" is a placeholder Passio sends when nothing runs
            continue
        bus = reports[0]
        route_id = str(bus.get("routeId"))
        if route_id not in route_ids:
            continue
        if bus.get("outOfService") or bus.get("outdated"):
            continue  # parked, or its GPS hasn't reported in a while
        vehicles.append({
            "id": str(bus["busId"]),
            "routeId": route_id,
            "lat": float(bus["latitude"]),
            "lon": float(bus["longitude"]),
        })
    return vehicles


def convert_etas(raw, route_ids):
    """Passio's eta response -> upcoming arrivals per stop, soonest first.

    Only the fields we need are copied. Passio's responses can include more,
    such as driver names, which Bobcatch has no reason to pass on.
    """
    arrivals = {}
    for stop_id, predictions in (raw.get("ETAs") or {}).items():
        for prediction in predictions:
            route_id = str(prediction.get("routeId") or "")
            arrives_at = prediction.get("etaUtc")
            # Entries without a route or time are messages such as "no vehicles".
            if route_id not in route_ids or not isinstance(arrives_at, (int, float)):
                continue
            if prediction.get("OOS"):
                continue
            arrivals.setdefault(str(stop_id), []).append({
                "routeId": route_id,
                "vehicleId": str(prediction.get("busId")),
                "arrivesAt": int(arrives_at),
            })
    for predictions in arrivals.values():
        predictions.sort(key=lambda prediction: prediction["arrivesAt"])
    return arrivals
