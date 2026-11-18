import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './style.css';
import { loadTransitData, IS_SAMPLE_DATA } from './data.js';
import { createMap } from './map.js';
import { setUpPlanView } from './plan-view.js';
import { createStopCard } from './stop-card.js';

const statusEl = document.getElementById('status');
const headerEl = document.querySelector('.topbar');
const bottomEl = document.getElementById('bottom');

// Which stops are highlighted on the map comes from two places: the From/To
// fields and the stop card. Both report here, and highlight() combines them.
const state = {
  data: null, // { routes, stops, vehicles, arrivals }
  planStopIds: [], // the chosen From and To stops
  cardStopId: null, // the stop whose arrivals card is open
};

const map = createMap(document.getElementById('map'), {
  onStopClick: openStop,
  onPopupClose: closeStop,
  getPadding: coveredMapArea,
});
const stopSheetEl = document.getElementById('stop-card');
// Must match the desktop breakpoint in style.css.
const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;
let plan = null; // set up once the data has loaded
let stopCard = null;

document.getElementById('data-badge').hidden = !IS_SAMPLE_DATA;
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.cardStopId) closeStop();
});

/**
 * How much of the map the header and the bottom cards hide, in pixels from each
 * edge. Measured every time, because the bottom grows when a card opens.
 */
function coveredMapArea() {
  const margin = 24;
  return {
    topLeft: [margin, headerEl.getBoundingClientRect().bottom],
    bottomRight: [margin, window.innerHeight - bottomEl.getBoundingClientRect().top + margin],
  };
}

// Desktop: the stop's card opens on the map, next to the stop.
// Phone: it opens in the bottom sheet, above From/To, where there is room.
function openStop(stopId) {
  state.cardStopId = stopId;
  if (isDesktop()) {
    const content = document.createElement('div');
    content.className = 'stop-card popup-card';
    stopCard.render(stopId, content);
    map.openStopPopup(stopId, content);
  } else {
    stopCard.render(stopId, stopSheetEl);
    stopSheetEl.hidden = false;
    highlight();
  }
}

function closeStop() {
  if (!state.cardStopId) return; // already closed (closing the popup calls this again)
  state.cardStopId = null;
  stopSheetEl.hidden = true;
  map.closeStopPopup();
  highlight();
}

function highlight() {
  map.highlightStops([...state.planStopIds, state.cardStopId].filter(Boolean));
}

// We only ask for location when the person taps the button, never on page load.
// The position stays in the browser: it is not sent to any server.
/** Ask the browser where the person is and show it on the map. Returns a promise of { lat, lon }. */
function locateUser() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser cannot share your location.'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const here = { lat: position.coords.latitude, lon: position.coords.longitude };
        map.showUserLocation(here);
        resolve(here);
      },
      (error) => {
        setLocating(false);
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

/** Pulse the locate button and stop double taps while the browser is looking. */
function setLocating(isLocating) {
  const button = document.getElementById('plan-locate');
  button.disabled = isLocating;
  button.classList.toggle('is-loading', isLocating);
}

function showNotice(text) {
  statusEl.textContent = text;
  statusEl.hidden = text === '';
}

async function start() {
  try {
    state.data = await loadTransitData();
    showNotice('');
    stopCard = createStopCard({
      data: state.data,
      onClose: closeStop,
      onPick: (role, stopId) => {
        closeStop();
        plan.setStop(role, stopId);
      },
    });
    plan = setUpPlanView({
      data: state.data,
      locateUser,
      onChange: (stopIds) => {
        state.planStopIds = stopIds;
        highlight();
      },
    });
    map.render(state.data);
  } catch (error) {
    console.error(error);
    showNotice('Could not load bus data. Check your connection and reload.');
  }
}

start();
