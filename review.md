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
