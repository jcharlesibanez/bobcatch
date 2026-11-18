// The card that opens when someone taps a stop on the map: when the next buses
// on each route arrive there, plus shortcuts to plan a trip from or to it.

import { readableTextColor } from './colors.js';

/**
 * @param data  { routes, stops, arrivals }
 * @param onClose  called when the close button is pressed
 * @param onPick  called with ('from' | 'to', stopId) from the two buttons
 */
export function createStopCard({ data, onClose, onPick }) {
  const stopsById = new Map(data.stops.map((stop) => [stop.id, stop]));

  /** Fill `element` with the card for one stop. */
  function render(stopId, element) {
    const stop = stopsById.get(stopId);
    const servingRoutes = data.routes.filter((route) => route.stopIds.includes(stopId));
    const arrivals = data.arrivals[stopId] ?? [];

    const header = el('div', 'stop-card-header');
    const title = el('h2', 'stop-card-title', stop.name);
    const close = el('button', 'close-button', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', onClose);
    header.append(title, close);

    const rows = el('ul', 'route-times');
    for (const route of servingRoutes) {
      const minutes = arrivals
        .filter((arrival) => arrival.routeId === route.id)
        .map((arrival) => arrival.minutes)
        .sort((a, b) => a - b);

      const badge = el('span', 'route-badge', route.shortName);
      badge.style.background = route.color;
      badge.style.color = readableTextColor(route.color);
      const name = el('span', 'route-name', route.name);
      const times = el('span', 'route-next', minutes.length ? minutes.slice(0, 2).map(formatMinutes).join(' · ') : 'No buses soon');
      times.classList.toggle('is-none', minutes.length === 0);

      const row = el('li', 'route-time');
      row.append(badge, name, times);
      rows.append(row);
    }

    const actions = el('div', 'stop-card-actions');
    for (const [role, label] of [['from', 'Start here'], ['to', 'Go here']]) {
      const button = el('button', `action-button is-${role}`, label);
      button.type = 'button';
      button.addEventListener('click', () => onPick(role, stopId));
      actions.append(button);
    }

    // Buttons go above the times so they stay visible when the list is long.
    element.replaceChildren(header, actions, el('p', 'eyebrow', 'Next buses'), rows);
  }

  return { render };
}

function el(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function formatMinutes(minutes) {
  return minutes <= 1 ? 'Due' : `${minutes} min`;
}
