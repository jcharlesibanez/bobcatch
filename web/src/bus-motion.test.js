import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteLanes } from './route-lanes.js';
import { makeGlide, placeOnRoute, separateDots, sidewaysGap } from './bus-motion.js';
import { at, route } from './test-helpers.js';

const bus = (x, y, heading) => {
  const [lat, lon] = at(x, y);
  return { id: 'bus', routeId: '1', lat, lon, heading };
};

test('a bus near its route is placed on the line', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0])]);
  const place = placeOnRoute(lanes, bus(120, 8));
  assert.equal(place.strandIndex, 0);
  assert.ok(Math.abs(place.s - 120) < 0.5, `s = ${place.s}`);
});

test('a bus far from its route stays where GPS says', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0])]);
  assert.deepEqual(placeOnRoute(lanes, bus(120, 300)), { latlng: at(120, 300) });
});

test('heading picks the right pass when a route uses a street both ways', () => {
  // Out east along y = 0, back west along y = 4.
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0], [500, 4], [0, 4])]);
  const goingWest = placeOnRoute(lanes, bus(200, 1, 270)); // nearer the eastbound line, but heading west
  assert.ok(goingWest.s > 500, `placed on the way back: s = ${goingWest.s}`);
  const goingEast = placeOnRoute(lanes, bus(200, 3, 90));
  assert.ok(goingEast.s < 500, `placed on the way out: s = ${goingEast.s}`);
});

test('a glide follows the road around a corner', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [100, 0], [100, 100])]);
  const glide = makeGlide(lanes, { strandIndex: 0, s: 50 }, { strandIndex: 0, s: 150 });
  // Halfway, the bus is at the corner, not cutting across the block.
  const [lat, lon] = glide(0.5).latlng;
  const [cornerLat, cornerLon] = at(100, 0);
  assert.ok(Math.abs(lat - cornerLat) < 1e-6 && Math.abs(lon - cornerLon) < 1e-6);
});

test('a glide on a loop goes forward across the start', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [100, 0], [100, 100], [0, 100], [0, 0])]);
  const glide = makeGlide(lanes, { strandIndex: 0, s: 390 }, { strandIndex: 0, s: 10 });
  const [lat, lon] = glide(0.5).latlng; // 20 m later: at the start point
  const [startLat, startLon] = at(0, 0);
  assert.ok(Math.abs(lat - startLat) < 1e-6 && Math.abs(lon - startLon) < 1e-6);
});

test('dots that are far apart are left alone', () => {
  const nudges = separateDots([{ x: 0, y: 0 }, { x: 50, y: 0 }], 20);
  assert.deepEqual(nudges, [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
});

test('overlapping dots with no direction are pushed apart equally', () => {
  const nudges = separateDots([{ x: 0, y: 0 }, { x: 10, y: 0 }], 20);
  assert.deepEqual(nudges, [{ x: -5, y: 0 }, { x: 5, y: 0 }]);
});

const east = { x: 1, y: 0 };

test('dots on the same spot end up side by side across the street', () => {
  const nudges = separateDots([{ x: 0, y: 0, direction: east }, { x: 0, y: 0, direction: east }], 20);
  assert.equal(Math.abs(nudges[0].x) + Math.abs(nudges[1].x), 0);
  assert.equal(nudges[1].y - nudges[0].y, 20);
});

test('a bus close behind another moves sideways, not forwards or back', () => {
  const nudges = separateDots([{ x: 0, y: 0, direction: east }, { x: 12, y: 0, direction: east }], 20);
  assert.equal(nudges[0].x, 0);
  assert.equal(nudges[1].x, 0);
  assert.ok(Math.hypot(12, nudges[1].y - nudges[0].y) >= 20);
});

test('the sideways gap always keeps dots apart, and changes gently', () => {
  for (let along = 0; along <= 40; along += 0.25) {
    const gap = sidewaysGap(along, 20);
    assert.ok(Math.hypot(along, gap) >= 20 - 1e-9, `${along} px along: only ${Math.hypot(along, gap)} apart`);
    assert.ok(Math.abs(sidewaysGap(along + 0.25, 20) - gap) <= 0.25, `steep at ${along} px`);
  }
  assert.equal(sidewaysGap(40, 20), 0);
});

test('a bus passing another moves aside and back without jumping', () => {
  // A drives past B in 1 px steps. The sideways gap should change a little at a time.
  let previous = null;
  for (let x = -30; x <= 30; x += 1) {
    const nudges = separateDots([{ x: 0, y: 0, direction: east }, { x, y: 0, direction: east }], 20);
    const gap = nudges[1].y - nudges[0].y;
    if (previous !== null) assert.ok(Math.abs(gap - previous) <= 7, `jump of ${gap - previous} px at x = ${x}`);
    previous = gap;
  }
});

test('a crowd of dots ends with no overlaps', () => {
  const anchors = Array.from({ length: 6 }, (_, i) => ({ x: i * 2, y: (i % 2) * 3 }));
  const nudges = separateDots(anchors, 20, { rounds: 50 });
  const final = anchors.map((a, i) => ({ x: a.x + nudges[i].x, y: a.y + nudges[i].y }));
  for (let i = 0; i < final.length; i++) {
    for (let j = i + 1; j < final.length; j++) {
      const gap = Math.hypot(final[i].x - final[j].x, final[i].y - final[j].y);
      assert.ok(gap > 19.5, `dots ${i} and ${j} are ${gap.toFixed(1)} px apart`);
    }
  }
});

test('a dot that is fading in claims only part of its room', () => {
  const nudges = separateDots([{ x: 0, y: 0, direction: east }, { x: 0, y: 0, direction: east, weight: 0.5 }], 20);
  assert.equal(nudges[1].y - nudges[0].y, 10);
});

test('a bus passing two side-by-side buses never makes them overlap', () => {
  // B1 and B2 sit on the same spot; A drives past them one lane over.
  for (let x = -30; x <= 30; x += 1) {
    const anchors = [
      { x, y: 5, direction: east },
      { x: 0, y: 0, direction: east },
      { x: 0, y: 0, direction: east },
    ];
    const nudges = separateDots(anchors, 20);
    const final = anchors.map((a, i) => ({ x: a.x + nudges[i].x, y: a.y + nudges[i].y }));
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const gap = Math.hypot(final[i].x - final[j].x, final[i].y - final[j].y);
        assert.ok(gap > 19.5, `at x = ${x}, dots ${i} and ${j} are ${gap.toFixed(1)} px apart`);
      }
    }
  }
});

test('a bus driving right over another keeps to one side of it', () => {
  // A's lane wobbles across B's position as it passes; the side must not flip.
  const sides = new Map();
  let previousSide = null;
  for (let x = -45; x <= 45; x += 1) {
    const wobble = Math.sin(x) * 0.5;
    const anchors = [
      { id: 'a', x, y: wobble, direction: east },
      { id: 'b', x: 0, y: 0, direction: east },
    ];
    const nudges = separateDots(anchors, 20, { sides });
    const gap = anchors[1].y + nudges[1].y - (anchors[0].y + nudges[0].y);
    if (Math.abs(gap) > 1) {
      if (previousSide !== null) assert.equal(Math.sign(gap), previousSide, `swapped sides at x = ${x}`);
      previousSide = Math.sign(gap);
    }
  }
});
