// The one place the app gets transit data from.
//
// Right now it reads saved files from /sample (real stops and routes, made-up
// buses and times; see public/sample/README.md) so the interface can be built
// before the Bobcatch server exists. When the server is ready, change this
// module to call it (for example /api/vehicles) and set IS_SAMPLE_DATA to
// false. Nothing else in the app needs to know where the data came from.

export const IS_SAMPLE_DATA = true;

const SAMPLE_URL = `${import.meta.env.BASE_URL}sample`;

async function getJson(name) {
  const response = await fetch(`${SAMPLE_URL}/${name}.json`);
  if (!response.ok) {
    throw new Error(`Could not load ${name} (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * Load everything the screen needs.
 * Shapes (see public/sample for examples):
 *   routes:   [{ id, shortName, name, color, stopIds: [stopId], path: [[[lat, lon]]] }]
 *   stops:    [{ id, name, lat, lon }]
 *   vehicles: [{ id, routeId, lat, lon }]
 *   arrivals: { [stopId]: [{ routeId, minutes }] }
 */
export async function loadTransitData() {
  const [routes, stops, vehicles, arrivals] = await Promise.all([
    getJson('routes'),
    getJson('stops'),
    getJson('vehicles'),
    getJson('arrivals'),
  ]);
  return { routes, stops, vehicles, arrivals };
}
