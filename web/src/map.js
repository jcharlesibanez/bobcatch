// Everything that touches Leaflet lives here, so the rest of the app can talk
// about "routes" and "stops" without knowing how the map is drawn.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import { buildRouteLanes, laneSpacingPx, lineWeightPx } from './route-lanes.js';
import { createBusLayer } from './bus-layer.js';
import { placeOnRoute, placeToPoint } from './bus-motion.js';

const NYC_CENTER = [40.7205, -73.9925];
const HIDDEN_BASEMAP_LAYERS = ['boundary_state', 'water_name'];
// Recolor parts of the basemap to the mock-up's green-tinted dark palette.
const BASEMAP_COLORS = [
  ['background', 'background-color', '#111716'],
  ['water', 'fill-color', '#0c2527'],
  ['landuse_park', 'fill-color', '#16201d'],
];
// A stop's dot is filled with its route's color, with a white ring so it
// stands out from the line it sits on. Selected stops turn lime.
const STOP_RING = '#ffffff';
const STOP_SELECTED_FILL = '#d9ff57';

/** Radius of a stop's dot: about half a lane, so a shared stop's dots sit in a row across the lanes. */
function stopRadiusPx(zoom, selected = false) {
  const radius = laneSpacingPx(zoom) / 2 + 2;
  return selected ? radius * 1.8 : radius;
}

/**
 * A polyline whose points are each shifted sideways by a number of pixels, so
 * lines sharing a street can sit side by side (see route-lanes.js).
 *
 * Leaflet turns a line's points into screen pixels in `_projectLatlngs`, again
 * after every zoom. We shift each point right after that, so the gap between
 * lines is the same number of pixels at every zoom. This relies on a Leaflet
 * 1.9 internal, the same one the Leaflet.PolylineOffset plugin uses; check it
 * still exists after upgrading Leaflet.
 *
 * options.offsets: one [dx, dy] per point, in lane units (x right, y down).
 */
const OffsetPolyline = L.Polyline.extend({
  _projectLatlngs(latlngs, result, projectedBounds) {
    const offsets = this.options.offsets;
    const spacing = laneSpacingPx(this._map.getZoom());
    const ring = latlngs.map((latlng, i) => {
      const point = this._map.latLngToLayerPoint(latlng);
      const shifted = L.point(point.x + offsets[i][0] * spacing, point.y + offsets[i][1] * spacing);
      projectedBounds.extend(shifted);
      return shifted;
    });
    result.push(ring);
  },
});

/**
 * A circle shifted sideways onto a route's lane, the same way as OffsetPolyline.
 * options.offset: [dx, dy] in lane units.
 */
const OffsetCircleMarker = L.CircleMarker.extend({
  _project() {
    const [dx, dy] = this.options.offset;
    const spacing = laneSpacingPx(this._map.getZoom());
    this._point = this._map.latLngToLayerPoint(this._latlng).add(L.point(dx * spacing, dy * spacing));
    this._updateBounds();
  },
});

/**
 * @param element  where to draw the map
 * @param onStopClick  called with a stop id when a stop is tapped
 * @param getPadding  returns { topLeft: [x, y], bottomRight: [x, y] }: how much of
 *   the map the floating header and panel cover, so we never zoom to a spot hidden
 *   underneath them
 */
export function createMap(element, { onStopClick, onPopupClose, getPadding }) {
  // No zoom buttons: pinch, scroll or double-tap zooms, and it keeps the map clean.
  const map = L.map(element, { zoomControl: false, attributionControl: false }).setView(NYC_CENTER, 13);
  L.control.attribution({ position: 'topright', prefix: false }).addTo(map);

  /** Move the map so all the given points show in the uncovered part of it. */
  function showPoints(points, maxZoom) {
    const { topLeft, bottomRight } = getPadding();
    map.flyToBounds(L.latLngBounds(points), {
      paddingTopLeft: topLeft,
      paddingBottomRight: bottomRight,
      maxZoom,
      duration: 0.5,
    });
  }

  // The background map is OpenFreeMap's dark style: free, no API key, built from
  // OpenStreetMap data. It is a "vector" map, drawn in the browser by MapLibre,
  // and it leaves out clutter like ferry and shipping lines.
  const basemap = L.maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/dark',
    attribution:
      '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Hide the few parts of that style we do not need. The dashed state border
  // down the Hudson and the names of bays and rivers only add noise here.
  const maplibreMap = basemap.getMaplibreMap();
  maplibreMap.on('load', () => {
    for (const layerId of HIDDEN_BASEMAP_LAYERS) {
      if (maplibreMap.getLayer(layerId)) maplibreMap.setLayoutProperty(layerId, 'visibility', 'none');
    }
    for (const [layerId, property, color] of BASEMAP_COLORS) {
      if (maplibreMap.getLayer(layerId)) maplibreMap.setPaintProperty(layerId, property, color);
    }
  });

  // One layer group per kind of thing, so each can be redrawn on its own.
  const routeLayer = L.layerGroup().addTo(map);
  // Lines get wider as you zoom in (their spacing is redone in OffsetPolyline).
  map.on('zoomend', () => {
    const zoom = map.getZoom();
    routeLayer.eachLayer((line) => line.setStyle({ weight: lineWeightPx(zoom) }));
    for (const [id, markers] of stopMarkers) {
      const radius = stopRadiusPx(zoom, selectedStopIds.includes(id));
      markers.forEach((marker) => marker.setRadius(radius));
    }
  });
  const stopLayer = L.layerGroup().addTo(map);
  const busLayer = createBusLayer(map);
  const stopMarkers = new Map(); // stopId -> one dot per route serving it
  const stopLatLngs = new Map(); // stopId -> where the stop really is
  let selectedStopIds = [];

  // The map's box changes size when the phone rotates or the panel collapses.
  // Leaflet has to be told, or it leaves grey gaps.
  new ResizeObserver(() => map.invalidateSize()).observe(element);

  /** Draw the given routes, their stops and their buses. Replaces what was there. */
  function render({ routes, stops, vehicles }) {
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    stopMarkers.clear();
    stopLatLngs.clear();

    const routesById = new Map(routes.map((route) => [route.id, route]));

    // Each route's path (the road it drives), split into lanes where routes share a street.
    const lanes = buildRouteLanes(routes);
    for (const strand of lanes.strands) {
      const { color } = routesById.get(strand.routeId);
      new OffsetPolyline(strand.latlngs, {
        offsets: strand.offsets,
        color,
        weight: lineWeightPx(map.getZoom()),
        opacity: 0.95,
      }).addTo(routeLayer);
    }
    busLayer.setRoutes(lanes, routesById);

    // One dot per route at each stop, on that route's lane and in its color,
    // so a stop shared by three routes shows three dots side by side.
    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
    for (const route of routes) {
      for (const stopId of new Set(route.stopIds)) {
        const stop = stopsById.get(stopId);
        if (!stop) continue;
        stopLatLngs.set(stopId, [stop.lat, stop.lon]);
        // Find where this route passes the stop (the same snapping as for buses).
        const point = placeToPoint(lanes, placeOnRoute(lanes, { routeId: route.id, lat: stop.lat, lon: stop.lon }));
        const marker = new OffsetCircleMarker(point.latlng, {
          offset: point.offset,
          radius: stopRadiusPx(map.getZoom()),
          color: STOP_RING,
          weight: 1.5,
          fillColor: route.color,
          fillOpacity: 1,
          routeColor: route.color,
        });
        marker.bindTooltip(stop.name);
        marker.on('click', () => onStopClick(stopId));
        marker.addTo(stopLayer);
        if (!stopMarkers.has(stopId)) stopMarkers.set(stopId, []);
        stopMarkers.get(stopId).push(marker);
      }
    }

    renderVehicles(vehicles);

    if (stopLatLngs.size > 0) {
      const { topLeft, bottomRight } = getPadding();
      const bounds = L.latLngBounds([...stopLatLngs.values()]);
      map.fitBounds(bounds, { paddingTopLeft: topLeft, paddingBottomRight: bottomRight });
    }
  }

  /**
   * Move the buses to fresh positions. Called every few seconds, so it leaves
   * the routes, stops and the map's view alone.
   */
  function renderVehicles(vehicles) {
    busLayer.update(vehicles);
  }

  /** Highlight the given stops and move the map so they are all in view. Pass [] to clear. */
  function highlightStops(stopIds) {
    selectedStopIds = stopIds;
    const chosen = [];
    const zoom = map.getZoom();
    for (const [id, markers] of stopMarkers) {
      const selected = stopIds.includes(id);
      for (const marker of markers) {
        const fillColor = selected ? STOP_SELECTED_FILL : marker.options.routeColor;
        marker.setStyle({ radius: stopRadiusPx(zoom, selected), fillColor });
        if (selected) marker.bringToFront();
      }
      if (selected) chosen.push(stopLatLngs.get(id));
    }
    if (chosen.length > 0) showPoints(chosen, 16);
  }

  let userMarker = null;

  /** Put the "you are here" dot at { lat, lon } and move the map there. */
  function showUserLocation({ lat, lon }) {
    if (!userMarker) {
      const dot = document.createElement('span');
      dot.className = 'user-dot';
      userMarker = L.marker([lat, lon], {
        icon: L.divIcon({ html: dot, className: '', iconSize: [20, 20] }),
        title: 'Your location',
        interactive: false,
        zIndexOffset: 2000,
      }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lon]);
    }
    showPoints([[lat, lon]], 16);
  }

  const popup = L.popup({
    className: 'stop-popup',
    closeButton: false,
    maxWidth: 320,
    minWidth: 280,
    autoPanPaddingTopLeft: [24, 100],
    autoPanPaddingBottomRight: [24, 140],
  });
  map.on('popupclose', () => onPopupClose());

  /** Show `content` in a card that points at the given stop. */
  function openStopPopup(stopId, content) {
    const latlng = stopLatLngs.get(stopId);
    if (latlng) popup.setLatLng(latlng).setContent(content).openOn(map);
  }

  function closeStopPopup() {
    map.closePopup(popup);
  }

  return { render, renderVehicles, highlightStops, showUserLocation, openStopPopup, closeStopPopup };
}
