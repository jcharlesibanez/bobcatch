// Small geometry helpers shared by the route-lane and bus-motion code.
//
// Latitude and longitude are awkward for geometry (a degree of longitude is
// shorter than a degree of latitude in New York), so we convert to a flat
// local grid in meters: x points east, y points north. Over a few miles the
// error from pretending the Earth is flat is far smaller than a bus.

const METERS_PER_DEGREE_LAT = 111_320;

/** A converter between [lat, lon] and local { x, y } meters, centered on `origin`. */
export function localProjection(origin) {
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toXY: (lat, lon) => ({
      x: (lon - origin.lon) * metersPerDegreeLon,
      y: (lat - origin.lat) * METERS_PER_DEGREE_LAT,
    }),
    toLatLon: ({ x, y }) => [origin.lat + y / METERS_PER_DEGREE_LAT, origin.lon + x / metersPerDegreeLon],
  };
}

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const length = (v) => Math.hypot(v.x, v.y);
export function unit(v) {
  const len = length(v);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/**
 * The point on segment a→b closest to p.
 * @returns {{ t: number, distance: number }}  t: 0 at a, 1 at b
 */
export function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const lengthSquared = dot(ab, ab);
  const t = lengthSquared > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / lengthSquared)) : 0;
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { t, distance: length(sub(p, closest)) };
}
