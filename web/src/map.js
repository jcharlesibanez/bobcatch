// Everything that touches Leaflet lives here, so the rest of the app can talk
// about "routes" and "stops" without knowing how the map is drawn.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import { readableTextColor } from './colors.js';

const NYC_CENTER = [40.7205, -73.9925];
const HIDDEN_BASEMAP_LAYERS = ['boundary_state', 'water_name'];
const STOP_FILL = '#e8edf2';
const STOP_OUTLINE = '#0b0f14';
const STOP_SELECTED_FILL = '#facc15';

export function createMap(element, { onStopClick }) {
  // No zoom buttons: pinch, scroll or double-tap zooms, and it keeps the map clean.
  const map = L.map(element, { zoomControl: false }).setView(NYC_CENTER, 13);

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
  });

  // One layer group per kind of thing, so each can be redrawn on its own.
  const routeLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  const vehicleLayer = L.layerGroup().addTo(map);
  const stopMarkers = new Map();

  // The map's box changes size when the phone rotates or the panel collapses.
  // Leaflet has to be told, or it leaves grey gaps.
  new ResizeObserver(() => map.invalidateSize()).observe(element);

  /** Draw the given routes, their stops and their buses. Replaces what was there. */
  function render({ routes, stops, vehicles }) {
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    vehicleLayer.clearLayers();
    stopMarkers.clear();

    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
    const routesById = new Map(routes.map((route) => [route.id, route]));
    const visibleStopIds = new Set();

    for (const route of routes) {
      // route.path is the road the bus actually drives: a list of lines, each a list of [lat, lon].
      L.polyline(route.path, { color: route.color, weight: 4, opacity: 0.9 }).addTo(routeLayer);
      route.stopIds.forEach((id) => visibleStopIds.add(id));
    }

    for (const stop of stops) {
      if (!visibleStopIds.has(stop.id)) continue;
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 5,
        color: STOP_OUTLINE,
        weight: 2,
        fillColor: STOP_FILL,
        fillOpacity: 1,
      });
      marker.bindTooltip(stop.name);
      marker.on('click', () => onStopClick(stop.id));
      marker.addTo(stopLayer);
      stopMarkers.set(stop.id, marker);
    }

    for (const vehicle of vehicles) {
      const route = routesById.get(vehicle.routeId);
      if (!route) continue;
      const badge = document.createElement('span');
      badge.className = 'bus-marker';
      badge.style.background = route.color;
      badge.style.color = readableTextColor(route.color);
      badge.textContent = route.shortName;
      L.marker([vehicle.lat, vehicle.lon], {
        icon: L.divIcon({ html: badge, className: '', iconSize: [28, 28] }),
        title: `${route.name} bus`,
        zIndexOffset: 1000,
      }).addTo(vehicleLayer);
    }

    if (visibleStopIds.size > 0) {
      const bounds = L.latLngBounds([...stopMarkers.values()].map((m) => m.getLatLng()));
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }

  /** Highlight the given stops and move the map so they are all in view. Pass [] to clear. */
  function highlightStops(stopIds) {
    const chosen = [];
    for (const [id, marker] of stopMarkers) {
      const selected = stopIds.includes(id);
      marker.setStyle({ radius: selected ? 9 : 5, fillColor: selected ? STOP_SELECTED_FILL : STOP_FILL });
      if (selected) {
        marker.bringToFront();
        chosen.push(marker.getLatLng());
      }
    }
    if (chosen.length === 1) {
      map.flyTo(chosen[0], Math.max(map.getZoom(), 16), { duration: 0.5 });
    } else if (chosen.length > 1) {
      map.flyToBounds(L.latLngBounds(chosen), { padding: [48, 48], maxZoom: 16, duration: 0.5 });
    }
  }

  let userMarker = null;

  /** Put the blue "you are here" dot at { lat, lon } and move the map there. */
  function showUserLocation({ lat, lon }) {
    if (!userMarker) {
      const dot = document.createElement('span');
      dot.className = 'user-dot';
      userMarker = L.marker([lat, lon], {
        icon: L.divIcon({ html: dot, className: '', iconSize: [16, 16] }),
        title: 'Your location',
        interactive: false,
        zIndexOffset: 2000,
      }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lon]);
    }
    map.flyTo([lat, lon], Math.max(map.getZoom(), 15), { duration: 0.5 });
  }

  return { render, highlightStops, showUserLocation };
}
