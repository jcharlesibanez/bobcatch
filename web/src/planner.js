// Trip planner: "what is the fastest way from stop A to stop B right now?"
//
// This first version only knows two ways to travel:
//   1. Walk the whole way.
//   2. Ride ONE bus route that visits both stops, in that order.
// It does not know about transfers, the subway, or walking to a nearby stop.
//
// Everything here is plain arithmetic on the data the app already has, so it
// runs in the browser and is easy to test: same inputs, same answer.

// Rough speeds. They are guesses, not measurements. Tune them with real data.
const WALK_METERS_PER_MINUTE = 80; // about 3 mph
const BUS_METERS_PER_MINUTE = 200; // about 7.5 mph, a slow Manhattan average
const MINUTES_STOPPED_PER_STOP = 0.5;
// Streets are a grid, so the real path is longer than a straight line.
const STREET_DETOUR_FACTOR = 1.3;

const EARTH_RADIUS_METERS = 6_371_000;

/** Straight-line distance between two { lat, lon } points, in meters (haversine formula). */
export function distanceMeters(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Find where on a route you would board and get off.
 * A route's stopIds are in driving order, and a loop lists its first stop
 * again at the end, so the same stop can appear twice. We try every place
 * the "from" stop appears and keep the shortest ride.
 * Returns { boardIndex, exitIndex } or null if the route does not go that way.
 */
function findRide(route, fromStopId, toStopId) {
  let best = null;
  route.stopIds.forEach((stopId, boardIndex) => {
    if (stopId !== fromStopId) return;
    const exitIndex = route.stopIds.indexOf(toStopId, boardIndex + 1);
    if (exitIndex === -1) return;
    if (!best || exitIndex - boardIndex < best.exitIndex - best.boardIndex) {
      best = { boardIndex, exitIndex };
    }
  });
  return best;
}

/** Estimated minutes on the bus between two positions on a route. */
function rideMinutes(route, boardIndex, exitIndex, stopsById) {
  let meters = 0;
  for (let i = boardIndex; i < exitIndex; i++) {
    meters += distanceMeters(stopsById.get(route.stopIds[i]), stopsById.get(route.stopIds[i + 1]));
  }
  const stopsPassed = exitIndex - boardIndex - 1;
  return (meters * STREET_DETOUR_FACTOR) / BUS_METERS_PER_MINUTE + stopsPassed * MINUTES_STOPPED_PER_STOP;
}

/**
 * Plan a trip between two stops.
 * @param {string} fromStopId
 * @param {string} toStopId
 * @param {{ routes, stops, arrivals }} data  same shapes as data.js
 * @returns {Array} options, fastest first. Each is either
 *   { type: 'walk', totalMinutes, meters }  or
 *   { type: 'bus', totalMinutes, waitMinutes, rideMinutes, stopCount, route }
 */
export function planTrip(fromStopId, toStopId, { routes, stops, arrivals }) {
  if (fromStopId === toStopId) return [];

  const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
  const from = stopsById.get(fromStopId);
  const to = stopsById.get(toStopId);
  if (!from || !to) return [];

  const walkMeters = distanceMeters(from, to) * STREET_DETOUR_FACTOR;
  const options = [
    { type: 'walk', totalMinutes: walkMeters / WALK_METERS_PER_MINUTE, meters: walkMeters },
  ];

  for (const route of routes) {
    const ride = findRide(route, fromStopId, toStopId);
    if (!ride) continue;

    // How long until this route's next bus reaches the boarding stop?
    const waits = (arrivals[fromStopId] ?? [])
      .filter((arrival) => arrival.routeId === route.id)
      .map((arrival) => arrival.minutes);
    if (waits.length === 0) continue; // no bus coming, so this is not an option right now
    const waitMinutes = Math.min(...waits);

    const riding = rideMinutes(route, ride.boardIndex, ride.exitIndex, stopsById);
    options.push({
      type: 'bus',
      totalMinutes: waitMinutes + riding,
      waitMinutes,
      rideMinutes: riding,
      stopCount: ride.exitIndex - ride.boardIndex,
      route,
    });
  }

  return options.sort((a, b) => a.totalMinutes - b.totalMinutes);
}
