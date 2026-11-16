// Everything that touches Leaflet lives here, so the rest of the app can talk
// about "routes" and "stops" without knowing how the map is drawn.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const NYC_CENTER = [40.7205, -73.9925];

export function createMap(element, { onStopClick }) {
  const map = L.map(element, { zoomControl: false }).setView(NYC_CENTER, 13);
  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

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
      const points = route.stopIds
        .map((id) => stopsById.get(id))
        .filter(Boolean)
        .map((stop) => [stop.lat, stop.lon]);
      L.polyline(points, { color: route.color, weight: 4, opacity: 0.8 }).addTo(routeLayer);
      route.stopIds.forEach((id) => visibleStopIds.add(id));
    }

    for (const stop of stops) {
      if (!visibleStopIds.has(stop.id)) continue;
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 7,
        color: '#1f2937',
        weight: 2,
        fillColor: '#ffffff',
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
      badge.textContent = route.id;
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

  /** Highlight one stop and move the map to it. Pass null to clear. */
  function selectStop(stopId) {
    for (const [id, marker] of stopMarkers) {
      const selected = id === stopId;
      marker.setStyle({ radius: selected ? 10 : 7, fillColor: selected ? '#facc15' : '#ffffff' });
      if (selected) {
        marker.bringToFront();
        map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.5 });
      }
    }
  }

  return { render, selectStop };
}
