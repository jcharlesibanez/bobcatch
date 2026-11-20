// How bus dots move: stuck to their route's line, gliding along it between
// updates, and nudged apart when two would overlap.
//
// Plain geometry with no Leaflet, so it can be tested (bus-motion.test.js).
// bus-layer.js does the drawing and the animation frames.

import { closestOnSegment, dot } from './geo.js';
import { pointAlong } from './route-lanes.js';

const SNAP_METERS = 60; // farther than this from its route, a bus is drawn where GPS says
const WRONG_WAY_PENALTY_METERS = 40; // how much to prefer the side of the street the bus is heading along
const MAX_GLIDE_METERS = 1500; // a bigger jump than this isn't animated along the road

/**
 * Where on its route's line a bus is: { strandIndex, s } (s = meters along
 * that strand), or { latlng } if it's nowhere near its route.
 *
 * Where a route uses the same street twice, once each way, both passes are
 * close to the bus. Passio's `heading` (degrees clockwise from north) tells
 * them apart: we prefer the pass going the way the bus is pointing.
 */
export function placeOnRoute(lanes, vehicle) {
  const p = lanes.projection.toXY(vehicle.lat, vehicle.lon);
  const radians = vehicle.heading == null ? null : (vehicle.heading * Math.PI) / 180;
  const heading = radians == null ? null : { x: Math.sin(radians), y: Math.cos(radians) };

  let best = null;
  lanes.strands.forEach((strand, strandIndex) => {
    if (strand.routeId !== vehicle.routeId) return;
    for (let i = 0; i < strand.xy.length - 1; i++) {
      const { t, distance } = closestOnSegment(p, strand.xy[i], strand.xy[i + 1]);
      if (distance > SNAP_METERS) continue;
      // 0 when the segment points the way the bus is heading, 1 when it points the opposite way.
      const wrongWay = heading ? (1 - dot(strand.segmentDirs[i], heading)) / 2 : 0;
      const score = distance + wrongWay * WRONG_WAY_PENALTY_METERS;
      if (!best || score < best.score) {
        best = { score, strandIndex, s: strand.s[i] + t * (strand.s[i + 1] - strand.s[i]) };
      }
    }
  });
  return best ? { strandIndex: best.strandIndex, s: best.s } : { latlng: [vehicle.lat, vehicle.lon] };
}

/** A place as a point to draw: { latlng, offset (lane units), direction (map x/y, or null) }. */
export function placeToPoint(lanes, place) {
  if (place.strandIndex === undefined) return { latlng: place.latlng, offset: [0, 0], direction: null };
  return pointAlong(lanes.strands[place.strandIndex], place.s);
}

/**
 * The path from one place to the next, as a function from progress (0 to 1)
 * to a point. When both places are on the same line, the dot follows the
 * line around corners instead of cutting straight across the block.
 */
export function makeGlide(lanes, from, to) {
  if (from && from.strandIndex !== undefined && from.strandIndex === to.strandIndex) {
    const strand = lanes.strands[from.strandIndex];
    let meters = to.s - from.s;
    if (strand.closed) {
      // On a loop, go the short way round: usually forward across the start.
      if (meters < -strand.length / 2) meters += strand.length;
      if (meters > strand.length / 2) meters -= strand.length;
    }
    if (Math.abs(meters) <= MAX_GLIDE_METERS) {
      return (progress) => pointAlong(strand, from.s + meters * progress);
    }
  }
  const a = placeToPoint(lanes, from ?? to);
  const b = placeToPoint(lanes, to);
  const mix = (x, y, k) => x + (y - x) * k;
  return (progress) => ({
    latlng: [mix(a.latlng[0], b.latlng[0], progress), mix(a.latlng[1], b.latlng[1], progress)],
    offset: [mix(a.offset[0], b.offset[0], progress), mix(a.offset[1], b.offset[1], progress)],
    direction: progress < 0.5 ? a.direction ?? b.direction : b.direction ?? a.direction,
  });
}

/**
 * Push dots apart until no two are closer than `minDistance` pixels.
 *
 * @param anchors  [{ x, y, direction, weight }] where each dot wants to be, in
 *   screen pixels. `direction` is the screen direction of travel (unit vector),
 *   or null. `weight` (0 to 1, default 1) shrinks how much room a dot claims
 *   while it fades in or out, so its neighbours slide instead of jumping.
 *   Pass them in the same order every time, with an `id` each.
 * @param options.sides  a Map to keep between calls (one per map). It
 *   remembers which side of each other two close dots went, so they don't
 *   swap sides as one passes the other.
 * @returns [{ x, y }]  how far to move each dot from its anchor
 *
 * Buses going along the same street are pushed apart *sideways*, across the
 * street, never forwards or backwards: a bus shouldn't look like it's ahead
 * of where it is. They are pushed just far enough that, together with the gap
 * along the street, they're `minDistance` apart. As one bus passes another,
 * that sideways gap grows from nothing and shrinks back to nothing, without
 * any jumps. Dots not travelling the same way are pushed apart along the line
 * between them.
 *
 * Pushing one pair apart can create a new overlap, so this repeats a few times.
 */
export function separateDots(anchors, minDistance, { sides = new Map(), rounds = 20 } = {}) {
  const positions = anchors.map(({ x, y }) => ({ x, y }));
  const context = { sides, closePairs: new Set() };
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const weight = Math.min(anchors[i].weight ?? 1, anchors[j].weight ?? 1);
        const pair = `${anchors[i].id ?? i}|${anchors[j].id ?? j}`;
        const push = pushApart(positions[i], positions[j], anchors[i], anchors[j], minDistance * weight, pair, context);
        if (!push) continue;
        positions[i].x -= push.x;
        positions[i].y -= push.y;
        positions[j].x += push.x;
        positions[j].y += push.y;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Pairs that are no longer close may pick a side afresh next time they meet.
  for (const pair of sides.keys()) {
    if (!context.closePairs.has(pair)) sides.delete(pair);
  }
  return positions.map((position, i) => ({ x: position.x - anchors[i].x, y: position.y - anchors[i].y }));
}

// How alike two directions must be (|cos| of the angle between them) for the
// dots to count as on the same street. Between these two values the two ways
// of pushing are blended, so a bus turning a corner doesn't make its
// neighbours jump from one rule to the other.
const CROSSING = 0.5; // 60° apart or more: push straight apart
const SAME_STREET = 0.8; // 37° apart or less: push sideways

/**
 * How far to move b (and minus that for a) so they're `minDistance` apart, or
 * null if they already are. a and b are where the dots are so far; anchorA and
 * anchorB are where they want to be.
 */
function pushApart(a, b, anchorA, anchorB, minDistance, pair, context) {
  if (minDistance === 0) return null;
  const alike =
    anchorA.direction && anchorB.direction ? Math.abs(dot(anchorA.direction, anchorB.direction)) : 0;
  const sideways = Math.min(1, Math.max(0, (alike - CROSSING) / (SAME_STREET - CROSSING)));
  const pushes = [];
  if (sideways > 0) pushes.push([sideways, pushAcross(a, b, anchorA, anchorB, minDistance, pair, context)]);
  if (sideways < 1) pushes.push([1 - sideways, pushStraight(a, b, minDistance)]);
  const total = { x: 0, y: 0 };
  for (const [share, push] of pushes) {
    if (!push) continue;
    total.x += push.x * share;
    total.y += push.y * share;
  }
  return total.x === 0 && total.y === 0 ? null : total;
}

/** Push apart across the street (perpendicular to a's direction). */
function pushAcross(a, b, anchorA, anchorB, minDistance, pair, context) {
  const direction = anchorA.direction;
  const across = { x: -direction.y, y: direction.x };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const along = dx * direction.x + dy * direction.y;
  const needed = sidewaysGap(along, minDistance);
  if (needed === 0) return null;
  // Which side b goes is decided once, when the two dots first come close,
  // from where they want to be (their anchors), and then kept until they part.
  // Deciding afresh each time would let them swap sides in a single frame
  // when one passes right over the other. If exactly level, b goes left.
  context.closePairs.add(pair);
  let side = context.sides.get(pair);
  if (side === undefined) {
    const anchorSideways = (anchorB.x - anchorA.x) * across.x + (anchorB.y - anchorA.y) * across.y;
    side = anchorSideways < -1e-6 ? -1 : 1;
    context.sides.set(pair, side);
  }
  const half = (needed - side * (dx * across.x + dy * across.y)) / 2;
  if (half <= 0) return null;
  return { x: across.x * side * half, y: across.y * side * half };
}

/**
 * How far apart across the street two dots must be when they're `along`
 * pixels apart along it.
 *
 * The least that works is a circle, sqrt(min² - along²), but that rises from
 * 0 to 6 px in the last pixel before two dots touch: a passing bus would yank
 * its neighbour aside. Instead we use min · (1 - (along / 2min)²)², which
 * starts easing aside from 2 · min away and never rises faster than about
 * 0.8 px per pixel travelled. It is never below the circle, so the dots still
 * stay `min` apart: with u = along / min, (1 - u²/4)⁴ + u² ≥ 1 for 0 ≤ u ≤ 1.
 */
export function sidewaysGap(along, minDistance) {
  const u = Math.abs(along) / (2 * minDistance);
  return u >= 1 ? 0 : minDistance * (1 - u * u) ** 2;
}

/** Push apart along the line between the two dots. */
function pushStraight(a, b, minDistance) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= minDistance) return null;
  const away = distance > 0.01 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
  const half = (minDistance - distance) / 2;
  return { x: away.x * half, y: away.y * half };
}
