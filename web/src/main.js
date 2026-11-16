import './style.css';
import { loadTransitData, IS_SAMPLE_DATA } from './data.js';
import { createMap } from './map.js';

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
};

const map = createMap(document.getElementById('map'), { onStopClick: selectStop });

document.getElementById('data-badge').hidden = !IS_SAMPLE_DATA;

handleEl.addEventListener('click', () => setPanelCollapsed(!panelEl.classList.contains('is-collapsed')));

function setPanelCollapsed(collapsed) {
  panelEl.classList.toggle('is-collapsed', collapsed);
  handleEl.setAttribute('aria-expanded', String(!collapsed));
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
  map.selectStop(state.stopId);
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
  const options = [{ id: null, name: 'All', color: null }, ...state.data.routes];
  chipsEl.replaceChildren(
    ...options.map((route) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = route.name;
      chip.setAttribute('aria-pressed', String(route.id === state.routeId));
      if (route.color) chip.style.setProperty('--route-color', route.color);
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

  const items = stops
    .filter((stop) => stopIds.has(stop.id))
    .map((stop) => {
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
    statusEl.hidden = true;
    renderChips();
    renderStops();
    renderMap();
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Could not load bus data. Check your connection and reload.';
  }
}

start();
