// The one place the app gets transit data from.
//
// It asks the Bobcatch server (server/ in this repo) first. If the server
// can't be reached, for example on a deployed copy with no server yet, it
// falls back to the saved files in /sample (real stops and routes, made-up
// buses and times; see public/sample/README.md) and says so with `isSample`.
// Nothing else in the app needs to know where the data came from.

const API_URL = '/api';
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample`;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  // A host with no server may answer /api/... with the app's HTML page; this throws then.
  return response.json();
}

/**
 * The server sends each arrival as an absolute time (`arrivesAt`, Unix seconds)
 * so it stays correct however long it was cached. The rest of the app wants
 * "minutes from now", so convert here. Rounded down: better to arrive at the
 * stop a little early than to miss the bus.
 */
function toMinutesFromNow(arrivals) {
  const now = Date.now();
  const result = {};
  for (const [stopId, list] of Object.entries(arrivals)) {
    result[stopId] = list
      .map(({ routeId, arrivesAt }) => ({ routeId, minutes: Math.floor((arrivesAt * 1000 - now) / 60_000) }))
      .filter((arrival) => arrival.minutes >= 0);
  }
  return result;
}

/**
 * Just the parts that change every few seconds. Throws if the server can't be reached.
 * @returns {{ vehicles, arrivals, updatedAt }}  updatedAt: when the server last heard from Passio, in ms
 */
export async function loadLiveData() {
  const live = await getJson(`${API_URL}/live`);
  return {
    vehicles: live.vehicles,
    arrivals: toMinutesFromNow(live.arrivals),
    updatedAt: live.updatedAt * 1000,
  };
}

async function loadFromServer() {
  const [statics, live] = await Promise.all([
    getJson(`${API_URL}/static`),
    // Right after the server starts it may have routes but no buses yet; that's fine.
    loadLiveData().catch(() => ({ vehicles: [], arrivals: {}, updatedAt: null })),
  ]);
  return { routes: statics.routes, stops: statics.stops, ...live, isSample: false };
}

async function loadSample() {
  const [routes, stops, vehicles, arrivals] = await Promise.all(
    ['routes', 'stops', 'vehicles', 'arrivals'].map((name) => getJson(`${SAMPLE_URL}/${name}.json`)),
  );
  return { routes, stops, vehicles, arrivals, updatedAt: null, isSample: true };
}

/**
 * Load everything the screen needs.
 * Shapes:
 *   routes:   [{ id, shortName, name, color, stopIds: [stopId], path: [[[lat, lon]]] }]
 *   stops:    [{ id, name, lat, lon }]
 *   vehicles: [{ id, routeId, lat, lon, heading }]  heading: degrees clockwise from north; may be missing
 *   arrivals: { [stopId]: [{ routeId, minutes }] }
 *   updatedAt: ms timestamp of the live data, or null
 *   isSample: true when showing the saved demo data
 */
export async function loadTransitData() {
  try {
    return await loadFromServer();
  } catch (error) {
    console.warn('Bobcatch server unavailable, showing demo data instead.', error);
    return loadSample();
  }
}
