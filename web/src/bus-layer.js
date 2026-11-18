// Draws buses as dots on their route's line and animates them.
//
// Each time new positions arrive, every dot glides along its line from where
// it was to where it is now. On every animation frame we:
//   1. work out where each dot wants to be (its "anchor") on its own lane,
//   2. ask separateDots how far to nudge each dot so none overlap,
//   3. move the markers to anchor + nudge.
//
// Smoothness comes from keeping every input continuous, not from easing the
// output: anchors glide, nudges grow and shrink with the gap between dots
// (see separateDots), and a bus that appears or disappears fades in or out
// while its "weight" (how hard it pushes its neighbours) goes from 0 to 1 or
// back. Easing the output would lag behind a fast bus and let dots overlap.
// The one thing still eased is a sudden jump in a nudge, which can happen when
// two dots swap sides; see JUMP_PX.
//
// Frames only run while something is moving, so an idle map costs nothing.

import L from 'leaflet';
import { readableTextColor } from './colors.js';
import { makeGlide, placeOnRoute, separateDots } from './bus-motion.js';
import { LANE_SPACING_PX } from './route-lanes.js';

const DOT_SIZE_PX = 18;
const MIN_GAP_PX = DOT_SIZE_PX + 2; // closest two dot centers may get
const GLIDE_MS = 2000; // how long a dot takes to reach its new position
const FADE_MS = 400; // how long a bus takes to appear or disappear
const JUMP_PX = 8; // a nudge changing more than this in one frame is a jump...
const JUMP_EASE_MS = 120; // ...and is smoothed out over about this long
const SETTLED_PX = 0.2;

export function createBusLayer(map) {
  const layer = L.layerGroup().addTo(map);
  // id -> { marker, place, glide, glideStart, weight, fadingOut, target, jump }
  const buses = new Map();
  let lanes = null;
  let routesById = new Map();
  const sides = new Map(); // remembered by separateDots between frames
  let frameId = null;
  let lastFrame = 0;
  let zooming = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Lane offsets and nudges are in screen pixels, which change with the zoom.
  // Leaflet animates markers during a zoom itself; afterwards we recompute.
  map.on('zoomstart', () => {
    zooming = true;
  });
  map.on('zoomend viewreset', () => {
    zooming = false;
    for (const bus of buses.values()) bus.target = null; // a new zoom is not a jump
    drawFrame();
  });

  /** Use these lanes (from buildRouteLanes) and this route lookup from now on. */
  function setRoutes(newLanes, newRoutesById) {
    lanes = newLanes;
    routesById = newRoutesById;
    layer.clearLayers();
    buses.clear();
  }

  /** New positions arrived: start each bus gliding toward its new place. */
  function update(vehicles) {
    if (!lanes) return;
    const now = performance.now();
    const seen = new Set();
    for (const vehicle of vehicles) {
      const route = routesById.get(vehicle.routeId);
      if (!route) continue;
      seen.add(vehicle.id);
      const place = placeOnRoute(lanes, vehicle);
      let bus = buses.get(vehicle.id);
      if (!bus) {
        bus = { marker: makeMarker(route), place: null, weight: 0, target: null, jump: { x: 0, y: 0 } };
        bus.marker.addTo(layer);
        buses.set(vehicle.id, bus);
      }
      bus.fadingOut = false;
      bus.glide = makeGlide(lanes, bus.place, place);
      bus.glideStart = bus.place ? now : -Infinity; // a new bus appears in place
      bus.place = place;
    }
    for (const [id, bus] of buses) {
      if (!seen.has(id)) bus.fadingOut = true; // removed once it has faded out
    }
    drawFrame();
  }

  function makeMarker(route) {
    const dot = document.createElement('span');
    dot.className = 'bus-dot';
    dot.style.background = route.color;
    dot.style.color = readableTextColor(route.color);
    dot.textContent = route.shortName;
    // Not clickable, so a bus parked on a stop doesn't block tapping the stop.
    return L.marker([0, 0], {
      icon: L.divIcon({ html: dot, className: '', iconSize: [DOT_SIZE_PX, DOT_SIZE_PX] }),
      interactive: false,
      keyboard: false,
      opacity: 0,
      zIndexOffset: 1000,
    });
  }

  /** Request a frame unless one is already coming. */
  function drawFrame() {
    if (frameId !== null) return;
    frameId = requestAnimationFrame((time) => {
      frameId = null;
      if (!zooming) frame(time);
    });
  }

  function frame(time) {
    const elapsed = lastFrame ? Math.min(time - lastFrame, 100) : 16;
    lastFrame = time;
    const instant = reducedMotion.matches;
    let stillMoving = false;

    // Fade buses in and out; forget the ones that have finished fading out.
    for (const [id, bus] of buses) {
      const step = instant ? 1 : elapsed / FADE_MS;
      bus.weight = bus.fadingOut ? Math.max(0, bus.weight - step) : Math.min(1, bus.weight + step);
      if (bus.fadingOut && bus.weight === 0) {
        bus.marker.remove();
        buses.delete(id);
      } else if (bus.weight > 0 && bus.weight < 1) {
        stillMoving = true;
      }
    }

    // 1. Anchors. Sorted by id so separateDots gets the same order every frame.
    const entries = [...buses.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const list = entries.map(([, bus]) => bus);
    const anchors = entries.map(([id, bus]) => {
      const progress = instant ? 1 : Math.min(1, (time - bus.glideStart) / GLIDE_MS);
      if (progress < 1) stillMoving = true;
      const point = bus.glide(easeInOut(progress));
      const pixel = map.latLngToLayerPoint(point.latlng);
      return {
        x: pixel.x + point.offset[0] * LANE_SPACING_PX,
        y: pixel.y + point.offset[1] * LANE_SPACING_PX,
        direction: point.direction && { x: point.direction.x, y: -point.direction.y }, // map y is north, screen y is down
        weight: bus.weight,
        id,
      };
    });

    // 2. Nudges.
    const targets = separateDots(anchors, MIN_GAP_PX, { sides });

    // 3. Move the markers, smoothing out any sudden jump in a nudge.
    const jumpDecay = instant ? 0 : Math.exp(-elapsed / JUMP_EASE_MS);
    list.forEach((bus, i) => {
      const target = targets[i];
      if (bus.target && Math.hypot(target.x - bus.target.x, target.y - bus.target.y) > JUMP_PX) {
        // Keep showing the dot where it was, and let that difference shrink away.
        bus.jump.x += bus.target.x - target.x;
        bus.jump.y += bus.target.y - target.y;
      }
      bus.target = target;
      bus.jump.x *= jumpDecay;
      bus.jump.y *= jumpDecay;
      if (Math.hypot(bus.jump.x, bus.jump.y) > SETTLED_PX) stillMoving = true;

      const position = L.point(anchors[i].x + target.x + bus.jump.x, anchors[i].y + target.y + bus.jump.y);
      bus.marker.setLatLng(map.layerPointToLatLng(position));
      bus.marker.setOpacity(bus.weight);
    });

    if (stillMoving) {
      drawFrame();
    } else {
      lastFrame = 0;
    }
  }

  return { setRoutes, update };
}

/** Slow start, slow finish: looks like a vehicle rather than a sliding cursor. */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
