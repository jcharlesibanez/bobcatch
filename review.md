# Bobcatch learning log

The goal of this project is to learn while building, not just to ship. Every merge gets a section here listing what you need to understand from it and questions that check you do. Claude adds the section on the same branch before the merge, as `CLAUDE.md` requires.

## How to use this file

1. Open the merge's **Code to read** list and read the files in that order, with the code open beside this page.
2. Answer the **Questions** in chat, in your own words. Getting one wrong is useful: it shows where to dig.
3. Once we've discussed a question, it gets ticked. A merge stays **Open** until all its questions are ticked.
4. **Decisions** are choices only you can make. **Exercises** are things for you to build yourself.

Each merge section has the same parts: Summary, Concepts to learn, Code to read, Walkthrough (only for code Claude wrote in a teach-don't-write area), Questions, Decisions, Exercises.

## Index

| # | Merge | Branch / PR | Status |
|---|---|---|---|
| 1 | Project setup, web app, trip planner, dark map, Figma restyle | `claude/new-session-fxobs6`, merged to `main` | Open: 0 of 17 questions |
| 2 | Server: live NYU bus data from Passio; side-by-side route lines and animated bus dots | `claude/intelligent-dirac-1me7i2` | Open: 0 of 18 questions |

---

## Merge 1: Project setup, web app, trip planner, dark map, Figma restyle

### Summary

- **Project setup:** `CLAUDE.md`, the README with the "not affiliated" disclaimer, the license switched from Apache-2.0 to AGPL-3.0, and a `.gitignore` that excludes `.env`.
- **Web app (`web/`):** a Vite + Leaflet installable web app (PWA). Phone layout puts the stop list in a bottom sheet; desktop moves it to a sidebar.
- **Data:** real NYU stops and routes saved once from Passio GO; bus positions and arrival times are invented. The app labels it "Demo data".
- **Trip planner:** compares walking with riding a single bus route. Written by Claude at your request, so it has a walkthrough below.
- **Dark theme:** dark-only colors, a dark vector map with clutter removed, each route drawn in its own color, and a button that shows your location.
- **Figma restyle:** full-screen map, From/To bar along the bottom, violet controls, lime highlights, self-hosted DM Sans. No stop list: tapping a stop opens a card with its next buses. The From field can start from the stop nearest you.

### Concepts to learn

| Concept | Why it matters here | Where it shows up |
|---|---|---|
| Copyleft licenses (AGPL vs permissive) | Decides what others must share if they run a copy of Bobcatch | `LICENSE`, README "License" |
| Keeping secrets out of git | A key in git history is leaked even after you delete the file | `.gitignore`, `CLAUDE.md` |
| ES modules and bundlers (Vite) | How `import` between files works and what `npm run build` produces | `web/src/*.js`, `web/vite.config.js` |
| Progressive web apps and service workers | What makes the site installable and work offline | `vite.config.js` (`VitePWA`) |
| Promises and `async`/`await` | Loading several files at once without freezing the page | `data.js` |
| State-driven rendering | Redrawing the screen from one source of truth | `main.js` (`state`, the `render…` functions) |
| Raster vs vector map tiles | Why the map download went from about 150 KB to 1.2 MB | `map.js` (basemap) |
| Web workers | Why MapLibre v6 failed to load and v5 didn't | `package.json` (MapLibre pinned to v5) |
| Geolocation, permissions and secure contexts | Why location only works on HTTPS or `localhost` | `main.js` (locate button) |
| CSS grid sizing | Why a layout can end up wider than the screen | `style.css` (`.trip-option`, `minmax(0, 1fr)`) |
| Great-circle distance (haversine) | Distance between two latitude/longitude points | `planner.js` (`distanceMeters`) |
| Graphs and shortest paths (Dijkstra) | What the planner needs to support transfers | Exercise below |
| Overlays and map padding | Keeping zoomed-to stops out from under the bottom cards | `main.js` (`coveredMapArea`), `map.js` (`showPoints`) |

### Code to read

Read in this order. The planner is required reading: it's routing logic, which `CLAUDE.md` puts in your teach-don't-write list.

| Order | File | What to look for |
|---|---|---|
| 1 | `web/src/planner.js` | All of it, with the walkthrough below |
| 2 | `web/src/data.js` | `loadTransitData` and the data shapes in its comment |
| 3 | `web/src/main.js` | The `state` object; `openStop`, `closeStop`, `highlight`; `locateUser`; `coveredMapArea` |
| 4 | `web/src/map.js` | `createMap`: the basemap, the three layer groups, `render`, `highlightStops`, `showUserLocation` |
| 5 | `web/src/plan-view.js` and `web/src/stop-card.js` | How the From/To bar calls `planTrip`; how the stop card groups arrivals by route |
| 6 | `web/src/colors.js` | `readableTextColor` |
| 7 | `web/src/style.css` | The Layout and Bottom sections: phone first, then the `min-width: 900px` desktop rules |

Not in the repo: the script that converted Passio's response into `web/public/sample/`. It's close to server work, so you may want to write your own version when you build the server.

### Walkthrough: `web/src/planner.js`

The planner compares two kinds of trip and returns them fastest first: walking the whole way, or riding **one** bus route that visits both stops in that order.

**Constants.** Walking is 80 m/min (about 3 mph), the bus 200 m/min (about 7.5 mph), plus 0.5 min stopped at each intermediate stop. Straight-line distances are multiplied by 1.3 because streets are a grid and the real path is longer. All four numbers are guesses, not measurements.

**`distanceMeters(a, b)`** uses the haversine formula. With $\varphi$ = latitude, $\lambda$ = longitude and $R$ = Earth's radius, after converting degrees to radians:

$$h = \sin^2\!\left(\tfrac{\Delta\varphi}{2}\right) + \cos\varphi_1 \cos\varphi_2 \sin^2\!\left(\tfrac{\Delta\lambda}{2}\right), \qquad d = 2R \arcsin\sqrt{h}$$

As a check, one degree of latitude comes out as 111.2 km.

**`findRide(route, from, to)`** answers "can I board here and get off there on this route?". A route's `stopIds` are in driving order, and a loop lists its first stop again at the end, so a stop can appear twice.

- It visits every position where the From stop appears.
- From each one, it looks for the To stop only at *later* positions. This is what enforces the bus's direction.
- It keeps the pair with the fewest stops between them, or returns `null` if the route never goes that way.

**`rideMinutes(...)`** adds the straight-line distances between each consecutive pair of stops from boarding to exit, applies the 1.3 factor, divides by bus speed, and adds the stopped time.

**`planTrip(from, to, data)`**:

1. Returns an empty list for the same stop twice or an unknown stop.
2. Builds a `Map` of stops by id for fast lookups.
3. Adds the walking option.
4. For each route, asks `findRide`; skips the route if there's no ride.
5. Uses the soonest arrival of that route at the From stop as the wait, and skips the route if no bus is coming. This is why Route W never appears.
6. Adds wait and ride time, then sorts every option by total.

**Known limitations**

- No transfers: Morton & Greenwich → Gramercy Green offers only walking, though G then F would work.
- A bus can't be ridden through the end of its loop.
- No walking to a nearby stop: "Third Avenue At 17th Street N" and "S" face each other across the street but count as unrelated.
- Ride time uses straight lines between stops, not the road path saved in `route.path`.

### Questions

**Project setup**

- [ ] 1. Bobcatch runs as a hosted website. What does AGPL-3.0 require of someone who runs a modified copy that Apache-2.0 doesn't, and why does that difference matter specifically for websites?
- [ ] 2. Suppose an API key gets committed, and the next commit deletes it. Is the key safe? What should you do?

**Front-end structure**

- [ ] 3. `data.js` is the only file that knows the data comes from sample files. When you connect your server, which files should change and which shouldn't? Why is that worth designing for?
- [ ] 4. `loadTransitData` uses `Promise.all` for four files. How would loading time change with four `await`s in a row, and what happens to `Promise.all` if one of the four fails?
- [ ] 5. Both the From/To bar and the stop card decide which stops are highlighted, but only `highlight()` in `main.js` touches the map. What bug would appear if each highlighted stops on its own?
- [ ] 6. `map.js` keeps routes, stops and buses in separate layer groups, and uses a `ResizeObserver`. What would go wrong without each?

**Trip planner**

- [ ] 7. In `findRide`, what would go wrong if the search for the To stop started at the boarding position itself instead of the position after it?
- [ ] 8. Why does the planner skip a route with no upcoming arrivals instead of showing it with an unknown wait? Can you think of a case where showing it would be better?
- [ ] 9. `planTrip` builds a `Map` of stops by id. If it searched the stops array instead for every lookup, how would the work grow with the number of stops? Answer in big-O.
- [ ] 10. Pick a real trip where the planner's answer would mislead a student, and name the assumption that causes it.

**Map and browser**

- [ ] 11. The basemap changed from raster PNG tiles to vector tiles drawn in the browser. Name one thing that got better and one that got worse.
- [ ] 12. Why do browsers allow location only on HTTPS or `localhost`? And why does Bobcatch ask on tap instead of when the page loads?
- [ ] 13. The phone layout was wider than the screen until the grid column changed from `1fr` to `minmax(0, 1fr)`. What does the `0` change? (Hint: look up a grid item's automatic minimum size.)

**Figma restyle**

- [ ] 16. `coveredMapArea` measures the bottom cards every time the map moves instead of once at start-up. Why?
- [ ] 17. The font is installed from npm (`@fontsource/dm-sans`) instead of loaded from Google Fonts. Name two reasons that suits a PWA.

**Before you build the server**

- [ ] 14. If Passio stops responding, should clients get the last good data or an error? Either way, how would a student know how old the data is?
- [ ] 15. Routes and stops rarely change, but bus positions change every few seconds. Should they be polled at the same rate? What would you choose for each, and why?

### Decisions

- [ ] Include the NYU Langone shuttles and the ferry? Passio lists them under NYU; they're left out for now.
- [ ] Stay with plain JavaScript, or move to a framework such as React while the app is still small?
- [ ] Map tiles for launch: OpenFreeMap is free and keyless today; check its usage terms before real traffic.
- [ ] MapLibre is pinned to v5 because v6 failed to load its worker file here. Revisit later?
- [ ] Open a pull request for this branch?

### Exercises

1. **Your first server step.** Write a Python script that calls `passiogo` once for NYU (system id `1007`) and prints routes, stops and vehicles. Compare what you get with the shapes in `web/public/sample/` and decide what your server's JSON should look like.
2. **Tests for the planner.** List five stop pairs and the answer you expect for each, before running anything. Then write them as tests. Include at least one loop route and one pair with no direct bus.
3. **Transfers (larger).** Model stops as nodes in a graph, with an edge for each bus segment and each short walk between nearby stops, and find the fastest path with Dijkstra's algorithm. Sketch the graph on paper before writing code.

---

## Merge 2: Server: live NYU bus data from Passio; side-by-side route lines and animated bus dots

### Summary

- **New `server/`:** a Python (FastAPI) server that polls Passio GO and serves `/api/static` (routes, stops), `/api/live` (buses, arrival times) and `/api/health`.
- **Real arrival times:** Passio's own predictions, fetched for every campus stop in one request. `passiogo` has no arrivals, so the server makes Passio's requests directly with `httpx` instead of using the package.
- **Web app:** `data.js` asks the server first and falls back to the demo files if it can't reach it. Buses and arrival times refresh every 10 s while the page is visible, without moving the map. A notice appears when data is over 90 s old.
- **Tests:** `pytest` for the converter and the poller, using hand-made and saved Passio responses. No test touches the network.
- **Side-by-side route lines:** where routes share a street, each gets its own lane a fixed number of pixels apart, so every line stays visible at every zoom.
- **Bus dots:** buses are dots stuck to their own route's lane. On each update they glide *along the road* to the new position. Dots that would overlap slide aside smoothly, across the street, and back once clear.
- **Web tests:** `npm test` in `web/` runs Node's built-in test runner on the geometry (no new dependency).
- The server now also sends each bus's `heading`.
- This is core-area code (polling, caching), all written by Claude: read it closely.

### Concepts to learn

| Concept | Why it matters here | Where it shows up |
|---|---|---|
| Server-side polling and caching | One request to Passio serves every student | `poller.py` (`Poller`, `Feed`) |
| Different refresh rates per feed | Routes change monthly, buses every second | `STATIC_INTERVAL`, `LIVE_INTERVAL` |
| Exponential backoff with a cap | Not hammering a service that's already down | `retry_delay`, `Poller.attempt` |
| Serving stale data vs. failing | A slightly old bus position beats an error page | `Feed.succeeded` / `Feed.failed`, `showFreshness` in `main.js` |
| Demand-driven polling | No one is looking at 4 AM, so don't poll | `client_asked`, `_clients_idle`, `_wake` |
| `asyncio`: tasks, events, `gather` | Two loops and two requests at once in one thread | `Poller.start`, `_loop`, `refresh_live` |
| Absolute vs. relative times | "Arrives at 9:05" survives caching; "in 3 min" doesn't | `arrivesAt` in `convert_etas`, `toMinutesFromNow` in `data.js` |
| Adapter layer for an unofficial API | Passio can change without warning; only one file should care | `passio.py` vs. `convert.py` |
| Pure functions and test fixtures | Testing without the network | `convert.py`, `tests/`, `SavedPassio` |
| Data minimization | Passio sends driver names; we never pass them on | `convert_etas` docstring |
| Graceful fallback | The deployed site has no server yet and still works | `loadTransitData` in `data.js` |
| Local flat coordinates (meters) | Geometry on lat/lon is distorted; meters make distances and angles simple | `geo.js` (`localProjection`) |
| Spatial grid index | Finding nearby lines without comparing every point with every other | `route-lanes.js` (`buildGrid`, `nearbySegments`) |
| Offsets in screen pixels vs. meters | Lanes are 3.5 to 7 px apart depending on zoom, so they need recomputing on every zoom | `OffsetPolyline` in `map.js`, `laneSpacingPx` |
| Map matching (snapping GPS to a line) | GPS is noisy; a dot should sit on its route, on the right side of a two-way street | `placeOnRoute` in `bus-motion.js` |
| Collision resolution by relaxation | Pushing pairs apart repeatedly until nothing overlaps | `separateDots`, `pushApart` |
| Continuity vs. smoothing | Easing the output lags behind fast dots; keeping every input continuous doesn't | `bus-layer.js` header comment, `sidewaysGap` |
| Hysteresis (remembering a decision) | Stops two dots swapping sides every frame when one passes over the other | `sides` in `separateDots` |
| `requestAnimationFrame` loops | Animating only while something moves, so an idle map costs no battery | `drawFrame`, `frame` in `bus-layer.js` |

### Code to read

| Order | File | What to look for |
|---|---|---|
| 1 | `server/bobcatch/passio.py` | The three requests; why `PassioClient` and `SavedPassio` have the same methods |
| 2 | `server/bobcatch/convert.py` | `campus_route_ids`, then each `convert_*` function. Compare with a file in `server/samples/` |
| 3 | `server/bobcatch/poller.py` | All of it: `Feed`, `retry_delay`, `_loop`, `attempt`, the idle pause |
| 4 | `server/bobcatch/app.py` | `lifespan`, the three endpoints, the `Cache-Control` headers, the 503 |
| 5 | `server/tests/` | What each test pins down, and what isn't tested |
| 6 | `web/src/data.js` | `loadTransitData`, `loadLiveData`, `toMinutesFromNow` |
| 7 | `web/src/main.js` | `refreshLiveData`, `showFreshness`, `startLiveUpdates` |
| 8 | `web/src/route-lanes.js` | The four steps in the header comment, then `findSharedStretches`, `laneUnits`, `smoothAlong` |
| 9 | `web/src/map.js` | `OffsetPolyline`: the only place lanes touch Leaflet |
| 10 | `web/src/bus-motion.js` | `placeOnRoute`, `makeGlide`, then `separateDots` and `sidewaysGap` |
| 11 | `web/src/bus-layer.js` | The header comment, `update`, `frame` |
| 12 | `web/src/*.test.js` | Each test's name says what it protects; find the one that failed during development (see below) |

Development notes worth reading before the code: the first version eased each dot's nudge over time, and dots still overlapped while one bus passed another. The fix wasn't a faster ease but removing every jump from the inputs (`sidewaysGap`, fading `weight`, remembered `sides`). The tests "keeps to one side" and "never makes them overlap" pin those bugs down.

### Questions

**Polling and caching**

- [ ] 1. Passio is asked every 10 s whether 1 or 1,000 students have the app open. Which line of code makes that true?
- [ ] 2. `Feed.succeeded` replaces `data` as a whole instead of updating its lists in place. What could a client receive if it updated in place and Passio failed halfway?
- [ ] 3. Passio goes down for 10 minutes. List the delays between attempts (see `retry_delay`). Why have a cap at all, and why not retry every 10 s?
- [ ] 4. The server has been idle overnight. Predict exactly what the first student's first `/api/live` request gets back, and what the app does with it.
- [ ] 5. `refresh_live` uses `asyncio.gather` for buses and arrivals. What changes if one of the two requests fails? Is that the behavior you'd want?
- [ ] 6. `/api/static` may be cached for 5 minutes, but `/api/live` says `no-store`. What would go wrong if live data could be cached by the browser or a CDN?

**Data and time**

- [ ] 7. The server sends `arrivesAt` (a moment in time), and the browser turns it into minutes. What would break if the server sent minutes instead? Think about caching and slow phones.
- [ ] 8. `toMinutesFromNow` rounds down. Give a case where rounding up would make a student miss the bus.
- [ ] 9. Routes are picked by "short name is one capital letter", not by a list of ids. Name one way this rule could pick the wrong routes, and how you'd notice.

**Design**

- [ ] 10. Passio changes its response format tomorrow. Which file should need changes, and which tests would tell you?
- [ ] 11. The deployed site has no server, so `data.js` falls back to demo data. When could falling back silently be harmful, rather than helpful?
- [ ] 12. Merge 1's questions 14 and 15 asked how you'd handle a Passio outage and polling rates. Compare your answers with what was built. What would you change?

**Route lanes and bus dots**

- [ ] 13. Lanes are spaced in pixels, not meters. What would the map look like zoomed out if they were spaced 5 m apart instead? Why does that force `OffsetPolyline` to redo its offsets on every zoom? And why must `lineWeightPx` stay below `laneSpacingPx`?
- [ ] 14. Two routes on the same two-way street go opposite directions. Walk through `laneUnits` for both and explain why they land on opposite sides, not on top of each other.
- [ ] 15. Without the grid in `buildGrid`, how would the work in `findSharedStretches` grow with the number of points? Answer in big-O, and estimate it for about 6,000 points.
- [ ] 16. `placeOnRoute` uses the bus's heading. Describe a real place on an NYU route where snapping by distance alone would put the dot on the wrong side, and what the student would see.
- [ ] 17. Why does a dot glide along the route instead of moving in a straight line from old position to new? When does `makeGlide` give up and use a straight line, and why?
- [ ] 18. `separateDots` pushes buses on the same street sideways, never forwards or backwards. Why does that matter for someone deciding whether to run for a bus?

### Decisions

- [ ] Where to host the server (it must run all the time, so not Vercel serverless functions as they are; options include Fly.io, Render, Railway, or a small VM).
- [ ] Polling rates: 10 s live, 6 h static, pause after 5 min idle. Too fast or slow?
- [ ] Contact NYU Transportation / Passio about Bobcatch and an official GTFS-Realtime feed before launch, since we rely on undocumented endpoints.
- [ ] Should the stop card show how old the arrival times are all the time, not only when over 90 s?
- [ ] Bus dots glide for 2 s after each update. Alternative: glide over the whole 10 s interval so buses always look like they're moving, at the cost of showing them about 10 s late. Which do students want?
- [x] At low zoom, the Broadway bundle was 7 lanes (35 px) wide. Decided: spacing grows with zoom, 3.5 px at zoom 13 to 7 px at zoom 18 (`laneSpacingPx`), rather than merging lanes when zoomed out.

### Exercises

1. **Watch it work.** Run the server during the day, open `/api/health`, then the app. Stop your Wi-Fi for two minutes and watch the server log and the app's notice. Explain each log line.
2. **Write a missing test.** There's no test that the live feed pauses when idle and wakes on `client_asked`. Write one (hint: shorten `IDLE_AFTER` in the test).
3. **Tune the lanes.** Change `SAME_STREET_METERS`, `MIN_RUN_METERS` and `TAPER_METERS` in `route-lanes.js` one at a time and look at Broadway and First Avenue. Predict what each will do first.
4. **Refresh the samples.** Save new responses in `server/samples/` while buses are running, so `BOBCATCH_SOURCE=saved` shows real campus buses. Check them for personal data first.
