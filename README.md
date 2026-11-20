# Bobcatch

**Catch the next NYU bus.** Bobcatch is an open-source, student-built web app that shows live NYU bus locations and arrival times, and aims to answer the question students actually have: *what's the fastest way to get where I'm going right now?*

> **Unofficial project.** Bobcatch is built by students and is **not affiliated with, endorsed by, or operated by New York University** or Passio Technologies. Data may be delayed or inaccurate. Always check official sources for service changes.

## Why

Getting around NYU currently means juggling several apps: one for NYU buses, another for late-night Safe Ride, and another for the subway. None of them talk to each other. Bobcatch aims to put it all in one place, built in the open, by and for the NYU community.

## Features

### Now (in progress)
- [ ] Live NYU bus positions on a map
- [ ] Arrival estimates for each stop
- [ ] Works on phones as an installable web app (PWA)

### Next
- [ ] Favorite stops and routes
- [ ] Combine NYU bus and MTA subway data: "fastest way to Tandon right now"
- [ ] Late-night mode: show Safe Ride hours and pickup locations after 11 p.m.
- [ ] Service alerts

### Later
- [ ] Part of a larger open student hub for NYU tools (e.g. classroom air quality)

## Data sources

| Source | What | Status |
|---|---|---|
| NYU buses (Passio GO) | Live vehicle positions, arrival estimates, routes, stops | Working, through Passio's unofficial endpoints (as used by the [`passiogo`](https://pypi.org/project/PassioGo/) package); seeking an official GTFS-Realtime feed |
| MTA | Subway and bus schedules and realtime data (GTFS) | Planned |

Bobcatch polls data on a server and serves it to clients, so individual users never hit upstream services directly. Please keep polling rates respectful.

## Getting started

The web app lives in `web/` and the server in `server/`. The app needs [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/jcharlesibanez/bobcatch.git
cd bobcatch/web
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173). Run the web app's tests with `npm test`. To see it on your phone, run `npm run dev -- --host` and open the "Network" address while on the same Wi-Fi.

On its own, the app shows **made-up sample data** from `web/public/sample/` and labels it "Demo data". For live buses, also run the server (Python 3.11 or newer) in a second terminal; see [`server/README.md`](server/README.md):

```bash
cd bobcatch/server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn bobcatch.app:app --reload --port 8000
```

When deployed on Vercel, the same API runs as Python functions in `web/api/` with no separate server to host; see "Deployment" in [`server/README.md`](server/README.md).

Never commit secrets. Put API keys and credentials in a `.env` file (already listed in `.gitignore`).

## Contributing

Contributions are welcome, especially from NYU students. Open an issue to discuss an idea or bug before starting a large change.

As the project grows, contributors may be asked to agree to a short contributor license agreement so the app can be distributed through app stores.

## License

Bobcatch is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. If you modify Bobcatch and run it for others, including as a hosted service, you must make your changes available under the same license. See [`LICENSE`](LICENSE).
