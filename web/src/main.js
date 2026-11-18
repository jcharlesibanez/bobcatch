import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './style.css';
import { loadTransitData, IS_SAMPLE_DATA } from './data.js';
import { createMap } from './map.js';
import { readableTextColor } from './colors.js';
import { setUpPlanView } from './plan-view.js';
import { distanceMeters } from './planner.js';

const chipsEl = document.getElementById('route-chips');
const listEl = document.getElementById('stop-list');
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const handleEl = document.getElementById('panel-handle');

// The whole screen is drawn from this one object.
const state = {
  data: null, // { routes, stops, vehicles, arrivals }
  routeId: null, // null means "all routes"
  stopId: null, // the stop whose arrivals are expanded
  userLocation: null, // { lat, lon } once the person taps the locate button
};

const map = createMap(document.getElementById('map'), { onStopClick: selectStop, getPadding: coveredMapArea });

/**
 * How much of the map the floating header and panel hide, in pixels from each edge.
 * On a phone the panel covers the bottom; on desktop it covers the left side.
 */
function coveredMapArea() {
  const margin = 24;
  const header = document.querySelector('.topbar').getBoundingClientRect();
  const panel = panelEl.getBoundingClientRect();
  // Must match the breakpoint in style.css where the panel becomes a sidebar.
  const panelIsSidebar = window.matchMedia('(min-width: 900px)').matches;
  return panelIsSidebar
    ? { topLeft: [panel.right + margin, header.bottom], bottomRight: [margin, margin] }
    : { topLeft: [margin, header.bottom], bottomRight: [margin, window.innerHeight - panel.top + margin] };
}

document.getElementById('data-badge').hidden = !IS_SAMPLE_DATA;

handleEl.addEventListener('click', () => setPanelCollapsed(!panelEl.classList.contains('is-collapsed')));

function setPanelCollapsed(collapsed) {
  panelEl.classList.toggle('is-collapsed', collapsed);
  handleEl.setAttribute('aria-expanded', String(!collapsed));
}

// We only ask for location when the person taps the button, never on page load.
// The position stays in the browser: it is not sent to any server.
const locateEl = document.getElementById('locate');
locateEl.addEventListener('click', () => locateUser().catch(() => {})); // locateUser shows its own error

/**
 * Ask the browser where the person is, then show it on the map and sort the
 * stop list nearest first. Returns a promise of { lat, lon }.
 */
function locateUser() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      showNotice('This browser cannot share your location.');
      reject(new Error('Geolocation not supported'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        state.userLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
        locateEl.classList.add('is-active');
        showNotice('');
        map.showUserLocation(state.userLocation);
        if (state.data) renderStops(); // nearest stops move to the top
        resolve(state.userLocation);
      },
      (error) => {
        setLocating(false);
        showNotice('Could not get your location. Check that location access is allowed for this site.');
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

/** Pulse the locate buttons and stop double taps while the browser is looking. */
function setLocating(isLocating) {
  for (const button of document.querySelectorAll('#locate, #plan-locate')) {
    button.disabled = isLocating;
    button.classList.toggle('is-loading', isLocating);
  }
}

function showNotice(text) {
  statusEl.textContent = text;
  statusEl.hidden = text === '';
}

function visibleRoutes() {
  const { routes } = state.data;
  return state.routeId ? routes.filter((route) => route.id === state.routeId) : routes;
}

function selectRoute(routeId) {
  state.routeId = routeId;
  state.stopId = null;
  renderChips();
  renderStops();
  renderMap();
}

function selectStop(stopId) {
  // Tapping the open stop again closes it.
  state.stopId = state.stopId === stopId ? null : stopId;
  renderStops();
  map.highlightStops(state.stopId ? [state.stopId] : []);
  if (state.stopId) {
    setPanelCollapsed(false);
    listEl.querySelector('[aria-expanded="true"]')?.scrollIntoView({ block: 'nearest' });
  }
}

function renderMap() {
  const routes = visibleRoutes();
  const routeIds = new Set(routes.map((route) => route.id));
  map.render({
    routes,
    stops: state.data.stops,
    vehicles: state.data.vehicles.filter((vehicle) => routeIds.has(vehicle.routeId)),
  });
}

function renderChips() {
  const options = [{ id: null, shortName: 'All', name: 'All routes', color: null }, ...state.data.routes];
  chipsEl.replaceChildren(
    ...options.map((route) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = route.shortName;
      chip.title = route.name;
      chip.setAttribute('aria-pressed', String(route.id === state.routeId));
      if (route.color) {
        chip.style.setProperty('--route-color', route.color);
        chip.style.setProperty('--route-text', readableTextColor(route.color));
      }
      chip.addEventListener('click', () => selectRoute(route.id));
      return chip;
    }),
  );
}

function renderStops() {
  const { stops, routes, arrivals } = state.data;
  const routesById = new Map(routes.map((route) => [route.id, route]));
  const routeIds = new Set(visibleRoutes().map((route) => route.id));
  const stopIds = new Set(visibleRoutes().flatMap((route) => route.stopIds));

  const shown = stops.filter((stop) => stopIds.has(stop.id));
  if (state.userLocation) {
    const here = state.userLocation;
    shown.sort((a, b) => distanceMeters(here, a) - distanceMeters(here, b));
  }

  const items = shown.map((stop) => {
      const upcoming = (arrivals[stop.id] ?? [])
        .filter((arrival) => routeIds.has(arrival.routeId))
        .sort((a, b) => a.minutes - b.minutes);
      const open = stop.id === state.stopId;

      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stop';
      button.setAttribute('aria-expanded', String(open));
      button.addEventListener('click', () => selectStop(stop.id));

      const name = document.createElement('span');
      name.className = 'stop-name';
      name.textContent = stop.name;

      const next = document.createElement('span');
      next.className = 'stop-next';
      next.textContent = upcoming.length ? formatMinutes(upcoming[0].minutes) : 'No buses';

      button.append(name, next);
      item.append(button);

      if (open) {
        const details = document.createElement('ul');
        details.className = 'arrivals';
        for (const arrival of upcoming) {
          const route = routesById.get(arrival.routeId);
          const row = document.createElement('li');
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = route.color;
          const label = document.createElement('span');
          label.textContent = route.name;
          const time = document.createElement('span');
          time.className = 'arrival-time';
          time.textContent = formatMinutes(arrival.minutes);
          row.append(dot, label, time);
          details.append(row);
        }
        if (!upcoming.length) {
          const row = document.createElement('li');
          row.textContent = 'No upcoming buses.';
          details.append(row);
        }
        item.append(details);
      }
      return item;
    });

  listEl.replaceChildren(...items);
}

function formatMinutes(minutes) {
  return minutes <= 1 ? 'Due' : `${minutes} min`;
}

async function start() {
  try {
    state.data = await loadTransitData();
    showNotice('');
    renderChips();
    renderStops();
    renderMap();
    setUpPlanView({ data: state.data, map, showAllRoutes: () => selectRoute(null), locateUser });
  } catch (error) {
    console.error(error);
    showNotice('Could not load bus data. Check your connection and reload.');
  }
}

start();
