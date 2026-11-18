import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteLanes, pointAlong, removeShortRuns, smoothAlong } from './route-lanes.js';
import { route } from './test-helpers.js';

const strandOf = (lanes, id) => lanes.strands.find((strand) => strand.routeId === id);
const offsetAt = (lanes, id, meters) => pointAlong(strandOf(lanes, id), meters).offset;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

test('a route on its own street is not shifted', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0])]);
  assert.deepEqual(offsetAt(lanes, '1', 250), [0, 0]);
});

test('two routes on the same street, same direction, sit side by side', () => {
  // Both go east along y = 0; B's line is drawn 3 m off, as hand-drawn paths are.
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0]), route('2', 'B', [0, 3], [500, 3])]);
  const a = offsetAt(lanes, '1', 250);
  const b = offsetAt(lanes, '2', 250);
  // Going east, "left" is north, which is up on screen (negative y).
  close(a[1], 0.5, 'A shifts half a lane down');
  close(b[1], -0.5, 'B shifts half a lane up');
});

test('routes going opposite ways on one street end up on opposite sides', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0]), route('2', 'B', [500, 0], [0, 0])]);
  const a = offsetAt(lanes, '1', 250);
  const b = offsetAt(lanes, '2', 250);
  assert.ok(Math.abs(a[1] - b[1]) > 0.99, `A at ${a[1]}, B at ${b[1]}`);
});

test('three routes on one street get three lanes', () => {
  const lanes = buildRouteLanes([
    route('3', 'C', [0, 0], [500, 0]),
    route('1', 'A', [0, 0], [500, 0]),
    route('2', 'B', [0, 0], [500, 0]),
  ]);
  const ys = ['1', '2', '3'].map((id) => offsetAt(lanes, id, 250)[1]);
  ys.forEach((y, i) => close(y, [1, 0, -1][i], `lane of route ${i + 1}`));
});

test('routes that only cross are not shifted', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0]), route('2', 'B', [250, -250], [250, 250])]);
  assert.deepEqual(offsetAt(lanes, '1', 250), [0, 0]);
});

test('lines move over gradually where a shared stretch starts', () => {
  // B joins A's street at x = 200.
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [500, 0]), route('2', 'B', [200, 200], [200, 0], [500, 0])]);
  const ys = [];
  for (let x = 100; x <= 300; x += 5) ys.push(offsetAt(lanes, '1', x)[1]);
  close(ys[0], 0, 'before B joins');
  close(ys[ys.length - 1], 0.5, 'fully shifted');
  ys.slice(1).forEach((y, i) => assert.ok(y >= ys[i] - 1e-9, 'never moves back'));
  const partway = ys.filter((y) => y > 0.01 && y < 0.49);
  assert.ok(partway.length >= 4, `a ramp, not a jump: ${partway.length} points partway`);
});

test('removeShortRuns fills short gaps, then drops short shared stretches', () => {
  const s = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const signs = [1, 1, 1, 0, 1, 1, 0, 0, 0, 1];
  removeShortRuns(signs, s, 25);
  // The one-point gap at 30 m is filled; the lone point at 90 m is dropped.
  assert.deepEqual(signs, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
});

test('smoothAlong turns a step into a ramp', () => {
  const s = [0, 10, 20, 30, 40, 50, 60];
  const smoothed = smoothAlong(s, [0, 0, 0, 1, 1, 1, 1], 20);
  assert.deepEqual(smoothed.map((v) => Math.round(v * 100) / 100), [0, 0, 0.33, 0.67, 1, 1, 1]);
});

test('pointAlong wraps around a loop', () => {
  const lanes = buildRouteLanes([route('1', 'A', [0, 0], [100, 0], [100, 100], [0, 100], [0, 0])]);
  const strand = strandOf(lanes, '1');
  assert.ok(strand.closed);
  assert.deepEqual(pointAlong(strand, strand.length + 50).latlng, pointAlong(strand, 50).latlng);
});
