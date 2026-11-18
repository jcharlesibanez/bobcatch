// Where routes share a street, draw their lines side by side instead of on top
// of each other, so every route stays visible at every zoom level.
//
// The idea, in four steps:
// 1. Turn each route line into a "strand": points every few meters, in local
//    meters (see geo.js), with the direction of travel at each point.
// 2. At each point, ask which *other* routes run along the same street: a line
//    within SAME_STREET_METERS that is roughly parallel (either direction).
// 3. Give each route a lane among the routes sharing that stretch. Lanes are
//    ordered by route name everywhere, so A is always on the same side of B.
// 4. Store each point's sideways offset in "lane units". The map multiplies it
//    by LANE_SPACING_PX, so lines stay a fixed number of pixels apart whatever
//    the zoom.
//
// Nothing here knows about Leaflet; it's plain geometry, tested in
// route-lanes.test.js.

import { localProjection, sub, dot, unit, length, closestOnSegment } from './geo.js';

/** Pixels between the centers of side-by-side lines. Lines are 4 px wide, so this leaves a 1 px gap. */
export const LANE_SPACING_PX = 5;

const SAMPLE_METERS = 8; // a point at least this often along every line
const SAME_STREET_METERS = 20; // two lines closer than this may be on the same street
const PARALLEL = Math.cos((25 * Math.PI) / 180); // ...if their directions differ by less than 25°
const MIN_RUN_METERS = 40; // ignore shared stretches (and gaps in them) shorter than this
const TAPER_METERS = 30; // how gradually a line moves over when its lane changes
const GRID_METERS = 25; // cell size of the lookup grid; must be at least SAME_STREET_METERS
const LOOP_METERS = 25; // a line whose ends are this close is a loop

/**
 * @param routes  [{ id, shortName, path: [[[lat, lon]]] }] as from data.js
 * @returns {{ projection, strands }}  one strand per line of each route:
 *   { routeId, latlngs: [[lat, lon]], xy: [{x, y}], s: [meters from start], length,
 *     closed, tangents: [{x, y}], offsets: [[dx, dy]] }
 *   offsets are in lane units, in screen directions (x right, y down).
 */
export function buildRouteLanes(routes) {
  const points = routes.flatMap((route) => route.path.flat());
  const origin = {
    lat: points.reduce((sum, p) => sum + p[0], 0) / Math.max(1, points.length),
    lon: points.reduce((sum, p) => sum + p[1], 0) / Math.max(1, points.length),
  };
  const projection = localProjection(origin);

  // Lane order: alphabetical by short name, the same everywhere on the map.
  const sorted = [...routes].sort((a, b) => a.shortName.localeCompare(b.shortName));
  const rank = new Map(sorted.map((route, index) => [route.id, index]));

  const strands = [];
  for (const route of routes) {
    for (const line of route.path) {
      const strand = makeStrand(route.id, line, projection);
      if (strand) strands.push(strand);
    }
  }

  const grid = buildGrid(strands);
  for (const strand of strands) {
    const shared = findSharedStretches(strand, strands, grid);
    const units = laneUnits(strand, shared, rank);
    strand.offsets = toScreenOffsets(strand, smoothAlong(strand.s, units, TAPER_METERS));
  }
  return { projection, strands };
}

/** Step 1: points every SAMPLE_METERS, distances along the line, and directions. */
function makeStrand(routeId, line, projection) {
  const xy = [];
  for (const [lat, lon] of line) {
    const point = projection.toXY(lat, lon);
    const previous = xy[xy.length - 1];
    if (previous && length(sub(point, previous)) < 0.5) continue; // drop near-duplicates
    if (previous) {
      // Fill long segments with extra points so lanes can change partway along them.
      const steps = Math.ceil(length(sub(point, previous)) / SAMPLE_METERS);
      for (let k = 1; k < steps; k++) {
        xy.push({ x: previous.x + ((point.x - previous.x) * k) / steps, y: previous.y + ((point.y - previous.y) * k) / steps });
      }
    }
    xy.push(point);
  }
  if (xy.length < 2) return null;

  const s = [0];
  for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + length(sub(xy[i], xy[i - 1])));
  const closed = length(sub(xy[0], xy[xy.length - 1])) < LOOP_METERS;

  // Direction of each segment, then of each point: halfway between the segment
  // before and after it. At a corner, `miter` lengthens the offset so the
  // shifted line keeps the same distance from the original on both sides.
  const segmentDirs = [];
  for (let i = 0; i < xy.length - 1; i++) segmentDirs.push(unit(sub(xy[i + 1], xy[i])));
  const tangents = [];
  const miters = [];
  for (let i = 0; i < xy.length; i++) {
    const before = segmentDirs[i - 1] ?? segmentDirs[i];
    const after = segmentDirs[i] ?? segmentDirs[i - 1];
    let tangent = unit({ x: before.x + after.x, y: before.y + after.y });
    if (length(tangent) === 0) tangent = after; // a U-turn
    tangents.push(tangent);
    miters.push(1 / Math.max(0.5, dot(tangent, after)));
  }

  return {
    routeId,
    latlngs: xy.map((point) => projection.toLatLon(point)),
    xy,
    s,
    length: s[s.length - 1],
    closed,
    segmentDirs,
    tangents,
    miters,
    offsets: null,
  };
}

/** A lookup from grid cell to the segments that touch it, so step 2 only checks nearby lines. */
function buildGrid(strands) {
  const grid = new Map();
  strands.forEach((strand, strandIndex) => {
    for (let i = 0; i < strand.xy.length - 1; i++) {
      // Segments are shorter than a cell, so the cells of their two ends cover them.
      const keys = new Set([cellKey(strand.xy[i]), cellKey(strand.xy[i + 1])]);
      for (const key of keys) {
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ strandIndex, segment: i });
      }
    }
  });
  return grid;
}

function cellKey({ x, y }) {
  return `${Math.floor(x / GRID_METERS)},${Math.floor(y / GRID_METERS)}`;
}

function nearbySegments(grid, { x, y }) {
  const cx = Math.floor(x / GRID_METERS);
  const cy = Math.floor(y / GRID_METERS);
  const found = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) found.push(...(grid.get(`${cx + dx},${cy + dy}`) ?? []));
  }
  return found;
}

/**
 * Step 2: for each point, which other routes share the street, and whether
 * they go the same way (+1) or the opposite way (-1).
 * @returns {Map<routeId, (1 | -1 | 0)[]>}  0 where that route isn't alongside
 */
function findSharedStretches(strand, strands, grid) {
  const shared = new Map();
  strand.xy.forEach((point, i) => {
    const closest = new Map(); // routeId -> { distance, sign }
    for (const { strandIndex, segment } of nearbySegments(grid, point)) {
      const other = strands[strandIndex];
      if (other.routeId === strand.routeId) continue;
      const alignment = dot(strand.tangents[i], other.segmentDirs[segment]);
      if (Math.abs(alignment) < PARALLEL) continue; // crossing, not sharing
      const { distance } = closestOnSegment(point, other.xy[segment], other.xy[segment + 1]);
      if (distance > SAME_STREET_METERS) continue;
      // If the other route uses this street both ways, line up with its pass
      // going our way; otherwise our side of the street could flip back and forth.
      const sign = Math.sign(alignment);
      const best = closest.get(other.routeId);
      if (!best || sign > best.sign || (sign === best.sign && distance < best.distance)) {
        closest.set(other.routeId, { distance, sign });
      }
    }
    for (const [routeId, { sign }] of closest) {
      if (!shared.has(routeId)) shared.set(routeId, new Array(strand.xy.length).fill(0));
      shared.get(routeId)[i] = sign;
    }
  });
  for (const signs of shared.values()) removeShortRuns(signs, strand.s, MIN_RUN_METERS);
  return shared;
}

/**
 * Clean up noise where lines meet or part: fill short gaps inside a shared
 * stretch, then forget shared stretches that are too short to matter.
 * Edits `signs` in place.
 */
export function removeShortRuns(signs, s, minMeters) {
  const runsOf = () => {
    const runs = [];
    let start = 0;
    for (let i = 1; i <= signs.length; i++) {
      if (i === signs.length || (signs[i] !== 0) !== (signs[start] !== 0)) {
        runs.push({ start, end: i - 1, shared: signs[start] !== 0 });
        start = i;
      }
    }
    return runs;
  };
  // A run covers from halfway to the point before it to halfway to the point after it.
  const last = s.length - 1;
  const meters = (run) =>
    (run.end < last ? (s[run.end] + s[run.end + 1]) / 2 : s[last]) -
    (run.start > 0 ? (s[run.start - 1] + s[run.start]) / 2 : s[0]);

  const runs = runsOf();
  runs.forEach((run, index) => {
    const between = index > 0 && index < runs.length - 1;
    if (!run.shared && between && meters(run) < minMeters) {
      for (let i = run.start; i <= run.end; i++) signs[i] = signs[run.start - 1];
    }
  });
  for (const run of runsOf()) {
    if (run.shared && meters(run) < minMeters) {
      for (let i = run.start; i <= run.end; i++) signs[i] = 0;
    }
  }
}

/**
 * Step 3: this route's lane at each point, in lane units from the middle of
 * the group (for 2 routes: -0.5 and +0.5; for 3: -1, 0, +1).
 *
 * Lanes are counted across the street from the left side of the first route
 * in alphabetical order (the "reference"). A route going the opposite way has
 * its own left and right swapped, hence `sign`.
 */
function laneUnits(strand, shared, rank) {
  return strand.xy.map((_, i) => {
    const alongside = [...shared].filter(([, signs]) => signs[i] !== 0).map(([routeId]) => routeId);
    if (alongside.length === 0) return 0;
    const group = [strand.routeId, ...alongside].sort((a, b) => rank.get(a) - rank.get(b));
    const reference = group[0];
    const sign = reference === strand.routeId ? 1 : shared.get(reference)[i];
    return sign * (group.indexOf(strand.routeId) - (group.length - 1) / 2);
  });
}

/** Average `values` over a window of `windowMeters` along the line, so lane changes ramp instead of jump. */
export function smoothAlong(s, values, windowMeters) {
  const half = windowMeters / 2;
  const result = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    while (hi < values.length && s[hi] <= s[i] + half) sum += values[hi++];
    while (s[lo] < s[i] - half) sum -= values[lo++];
    result.push(sum / (hi - lo));
  }
  return result;
}

/**
 * Step 4: turn lane units into a sideways shift on screen. Positive units go
 * to the left of the direction of travel. Screen y points down, map y points
 * north, hence the minus sign.
 */
function toScreenOffsets(strand, units) {
  return units.map((laneUnit, i) => {
    const t = strand.tangents[i];
    const left = { x: -t.y, y: t.x };
    const scale = laneUnit * strand.miters[i];
    return [left.x * scale, -left.y * scale];
  });
}

/**
 * The point `meters` along a strand, with its offset and direction.
 * Wraps around on loops.
 */
export function pointAlong(strand, meters) {
  let target = meters;
  if (strand.closed) target = ((target % strand.length) + strand.length) % strand.length;
  target = Math.min(Math.max(target, 0), strand.length);

  // Binary search for the segment containing `target`.
  let lo = 0;
  let hi = strand.s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (strand.s[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = strand.s[hi] - strand.s[lo];
  const t = span > 0 ? (target - strand.s[lo]) / span : 0;
  const mix = (a, b) => a + (b - a) * t;
  return {
    latlng: [mix(strand.latlngs[lo][0], strand.latlngs[hi][0]), mix(strand.latlngs[lo][1], strand.latlngs[hi][1])],
    offset: [mix(strand.offsets[lo][0], strand.offsets[hi][0]), mix(strand.offsets[lo][1], strand.offsets[hi][1])],
    direction: strand.segmentDirs[Math.min(lo, strand.segmentDirs.length - 1)],
  };
}
