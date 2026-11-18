"""Tests for convert.py, using small hand-made responses shaped like Passio's."""

from bobcatch.convert import (
    campus_route_ids,
    convert_etas,
    convert_routes_and_stops,
    convert_vehicles,
)

RAW_ROUTES_AND_STOPS = {
    "routes": {
        # name, color, then [position, stopId, _] out of order on purpose
        "1": ["Route A", "#f00", ["2", "20", 0], ["1", "10", 0], ["3", "10", 0]],
        "2": ["Brooklyn Shuttle", "#0f0", ["1", "30", 0]],
    },
    "routeShortNames": {"1": "A", "2": ""},
    "routePoints": {
        "1": [[
            {"lat": "40.7290505", "lng": "-73.9937111"},
            {"lat": "40.7290505", "lng": "-73.9937111"},  # repeated point
            {"lat": "40.7300000", "lng": "-73.9900000"},
        ]],
    },
    "stops": {
        # Passio lists a stop once per route that serves it.
        "ID10": {"id": "10", "name": "715 Broadway ", "latitude": 40.7290505531, "longitude": -73.993711},
        "ID10b": {"id": "10", "name": "715 Broadway", "latitude": 40.7290505531, "longitude": -73.993711},
        "ID20": {"id": "20", "name": "Union Square", "latitude": 40.735, "longitude": -73.99},
        "ID30": {"id": "30", "name": "Hospital", "latitude": 40.69, "longitude": -73.99},
    },
}


def test_only_lettered_routes_are_kept():
    assert campus_route_ids(RAW_ROUTES_AND_STOPS) == {"1"}


def test_routes_list_stops_in_driving_order():
    routes, _ = convert_routes_and_stops(RAW_ROUTES_AND_STOPS)
    assert routes[0]["stopIds"] == ["10", "20", "10"]
    assert routes[0]["shortName"] == "A"


def test_paths_are_rounded_and_drop_repeats():
    routes, _ = convert_routes_and_stops(RAW_ROUTES_AND_STOPS)
    assert routes[0]["path"] == [[[40.72905, -73.99371], [40.73, -73.99]]]


def test_stops_are_deduplicated_and_limited_to_kept_routes():
    _, stops = convert_routes_and_stops(RAW_ROUTES_AND_STOPS)
    assert sorted(stop["id"] for stop in stops) == ["10", "20"]
    broadway = next(stop for stop in stops if stop["id"] == "10")
    assert broadway == {"id": "10", "name": "715 Broadway", "lat": 40.729051, "lon": -73.993711}


def bus(bus_id, route_id, **extra):
    return [{"busId": bus_id, "routeId": route_id, "latitude": "40.7", "longitude": "-73.9",
             "outOfService": 0, "outdated": 0, **extra}]


def test_vehicles_skip_other_routes_parked_and_stale_buses():
    raw = {"buses": {
        "-1": [{"busId": -1}],
        "a": bus(1, "1"),
        "b": bus(2, "2"),
        "c": bus(3, "1", outOfService=1),
        "d": bus(4, "1", outdated=1),
    }}
    assert convert_vehicles(raw, {"1"}) == [{"id": "1", "routeId": "1", "lat": 40.7, "lon": -73.9}]


def test_vehicles_handle_no_buses():
    assert convert_vehicles({"buses": {}}, {"1"}) == []


def test_etas_keep_only_what_we_need_and_sort():
    raw = {"ETAs": {
        "10": [
            {"routeId": "1", "busId": 7, "etaUtc": 2000, "OOS": 0, "driver": "Someone"},
            {"routeId": "1", "busId": 8, "etaUtc": 1000, "OOS": 0},
            {"routeId": "2", "busId": 9, "etaUtc": 500, "OOS": 0},
            {"routeId": "1", "busId": 10, "etaUtc": 900, "OOS": 1},
        ],
        "0000": [{"routeId": "", "eta": "no vehicles"}],
    }}
    assert convert_etas(raw, {"1"}) == {"10": [
        {"routeId": "1", "vehicleId": "8", "arrivesAt": 1000},
        {"routeId": "1", "vehicleId": "7", "arrivesAt": 2000},
    ]}
