# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Bobcatch is an unofficial, open-source web app (PWA) for NYU students that shows live NYU bus locations and arrival times. Later goals: combine NYU bus data with MTA subway data to answer "what's the fastest way there right now?", add a late-night Safe Ride mode, and become part of a larger open student hub.

- License: **AGPL-3.0**. New source files should be compatible with it; flag any dependency with an unusual or incompatible license before adding it.
- Not affiliated with NYU or Passio. Never use NYU logos or official artwork, and keep the disclaimer in the README.

## How to work with me (important)

I'm a CS student building this to help my community **and to become a better engineer**. Default to teaching, not autopilot.

**Hand off freely** (just do it):
- Project setup, config, tooling, boilerplate
- Styling and layout
- Tests for code I've written, when I ask

**Teach, don't just write** (explain first, let me implement):
- The backend that polls bus data and serves it to clients
- Caching and polling strategy
- Merging NYU bus and MTA data
- Routing / "fastest way there" logic

For these core areas: explain the approach and trade-offs, point me to the relevant concepts, review my code and ask questions about it. Only write a full implementation if I explicitly ask. Then explain it line by line.

**Rule: never commit code I can't explain.** If you write something non-trivial, walk me through it before committing.

## Data sources

- **NYU buses:** Passio GO. Prototyping uses the unofficial `passiogo` Python package, which may break without warning. The goal is an official GTFS-Realtime feed from NYU.
- **MTA:** public GTFS / GTFS-Realtime feeds (planned).
- The server polls upstream sources and clients only talk to our server. Keep polling respectful (every several seconds at most, with backoff on errors).
- This environment may restrict outbound network access. If upstream calls fail, say so plainly rather than retrying in a loop, and suggest working from saved sample data.

## Conventions

- Never commit secrets. Credentials live in `.env`, which is gitignored.
- Keep commits small and focused, with clear messages.
- Prefer simple, readable code over clever code. This is a learning project and other students should be able to contribute.
