// The "Plan a trip" tab: the From/To form and the list of options.
// The actual decision-making lives in planner.js; this file only shows it.

import { planTrip, distanceMeters } from './planner.js';
import { readableTextColor } from './colors.js';

export function setUpPlanView({ data, map, showAllRoutes, locateUser }) {
  const tabs = { stops: document.getElementById('tab-stops'), plan: document.getElementById('tab-plan') };
  const views = { stops: document.getElementById('view-stops'), plan: document.getElementById('view-plan') };
  const fromEl = document.getElementById('plan-from');
  const toEl = document.getElementById('plan-to');
  const resultsEl = document.getElementById('plan-results');

  // Fill both dropdowns with every stop, A to Z.
  const sortedStops = [...data.stops].sort((a, b) => a.name.localeCompare(b.name));
  for (const select of [fromEl, toEl]) {
    select.append(new Option('Choose a stop', ''));
    for (const stop of sortedStops) select.append(new Option(stop.name, stop.id));
  }

  function showTab(name) {
    for (const key of Object.keys(tabs)) {
      tabs[key].setAttribute('aria-selected', String(key === name));
      views[key].hidden = key !== name;
    }
    if (name === 'plan') {
      showAllRoutes(); // a trip can use any route, so undo any route filter
      update();
    } else {
      map.highlightStops([]);
    }
  }

  function update() {
    const fromId = fromEl.value;
    const toId = toEl.value;
    map.highlightStops([fromId, toId].filter(Boolean));

    if (!fromId || !toId) {
      resultsEl.replaceChildren();
      return;
    }
    if (fromId === toId) {
      resultsEl.replaceChildren(message('Pick two different stops.'));
      return;
    }
    const options = planTrip(fromId, toId, data);
    resultsEl.replaceChildren(...options.map((option, index) => optionCard(option, index === 0)));
  }

  tabs.stops.addEventListener('click', () => showTab('stops'));
  tabs.plan.addEventListener('click', () => showTab('plan'));
  fromEl.addEventListener('change', update);
  toEl.addEventListener('change', update);
  // "Locate" in the From field: start from whichever stop is closest to the person.
  document.getElementById('plan-locate').addEventListener('click', async () => {
    try {
      const here = await locateUser();
      fromEl.value = nearestStop(here, data.stops).id;
      update();
    } catch {
      resultsEl.replaceChildren(message('Could not get your location. Choose a stop instead.'));
    }
  });
  document.getElementById('plan-swap').addEventListener('click', () => {
    [fromEl.value, toEl.value] = [toEl.value, fromEl.value];
    update();
  });
}

/** The stop closest to { lat, lon }, as the crow flies. */
function nearestStop(here, stops) {
  let best = stops[0];
  for (const stop of stops) {
    if (distanceMeters(here, stop) < distanceMeters(here, best)) best = stop;
  }
  return best;
}

function message(text) {
  const item = document.createElement('li');
  item.className = 'hint';
  item.textContent = text;
  return item;
}

function optionCard(option, isFastest) {
  const item = document.createElement('li');
  item.className = 'trip-option';
  item.classList.toggle('is-fastest', isFastest);

  const icon = el('span', 'trip-icon');
  const title = el('span', 'trip-title');
  const detail = el('span', 'trip-detail');
  const total = el('span', 'trip-total', formatMinutes(option.totalMinutes));

  if (option.type === 'walk') {
    icon.textContent = '🚶';
    title.textContent = 'Walk';
    detail.textContent = formatDistance(option.meters);
  } else {
    icon.textContent = option.route.shortName;
    icon.style.background = option.route.color;
    icon.style.color = readableTextColor(option.route.color);
    title.textContent = option.route.name;
    const stops = option.stopCount === 1 ? '1 stop' : `${option.stopCount} stops`;
    detail.textContent = `Bus in ${formatMinutes(option.waitMinutes)}, then ${formatMinutes(option.rideMinutes)} ride (${stops})`;
  }

  if (isFastest) total.prepend(el('span', 'trip-tag', 'Fastest'));
  item.append(icon, title, total, detail);
  return item;
}

function el(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function formatMinutes(minutes) {
  return `${Math.max(1, Math.round(minutes))} min`;
}

function formatDistance(meters) {
  const miles = meters / 1609.34;
  return miles < 0.1 ? `${Math.round(meters * 3.281)} ft` : `${miles.toFixed(1)} mi`;
}
