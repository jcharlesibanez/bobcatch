// Helpers for the *.test.js files: build small made-up routes in meters.

const ORIGIN = { lat: 40.73, lon: -73.99 };
const METERS_PER_DEGREE_LAT = 111_320;
const METERS_PER_DEGREE_LON = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** [lat, lon] for a point `x` meters east and `y` meters north of a fixed spot. */
export function at(x, y) {
  return [ORIGIN.lat + y / METERS_PER_DEGREE_LAT, ORIGIN.lon + x / METERS_PER_DEGREE_LON];
}

/** A route whose single line goes through the given [x, y] meter points. */
export function route(id, shortName, ...points) {
  return { id, shortName, name: `Route ${shortName}`, color: '#fff', stopIds: [], path: [points.map(([x, y]) => at(x, y))] };
}
