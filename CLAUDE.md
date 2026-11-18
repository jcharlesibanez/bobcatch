# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Bobcatch is an unofficial, open-source web app (PWA) for NYU students that shows live NYU bus locations and arrival times. Later goals: combine NYU bus data with MTA subway data to answer "what's the fastest way there right now?", add a late-night Safe Ride mode, and become part of a larger open student hub.

- License: **AGPL-3.0**. New source files should be compatible with it; flag any dependency with an unusual or incompatible license before adding it.
- Not affiliated with NYU or Passio. Never use NYU logos or official artwork, and keep the disclaimer in the README.

## How to work with me (important)

I'm a CS student building this to help my community **and to become a better engineer**.

You (Claude) implement everything, including the core areas below. My learning happens through `review.md`, not by writing every line myself.

Core areas where I most need to understand the code you write:
- The backend that polls bus data and serves it to clients
- Caching and polling strategy
- Merging NYU bus and MTA data
- Routing / "fastest way there" logic

### Learning log (`review.md`)

Every merge gets a short section in `review.md`, added on the same branch before the merge, plus a row in its index.

- List only what I should learn from the change: key concepts, which code to read, and a few questions that test understanding (why, predict, what if). Focus on the core areas above.
- Keep it brief. Bullets, not essays; no code dumps; point to files and function names, not line numbers.
- Don't answer the questions in the file. Tick a question only after we've discussed it, and keep the index status current.

## Data sources

- **NYU buses:** Passio GO. Prototyping uses the unofficial `passiogo` Python package, which may break without warning. The goal is an official GTFS-Realtime feed from NYU.
- **MTA:** public GTFS / GTFS-Realtime feeds (planned).
- The server polls upstream sources and clients only talk to our server. Keep polling respectful (every several seconds at most, with backoff on errors).
- This environment may restrict outbound network access. If upstream calls fail, say so plainly rather than retrying in a loop, and suggest working from saved sample data.

## Conventions

- Never commit secrets. Credentials live in `.env`, which is gitignored.
- Keep commits small and focused, with clear messages.
- Prefer simple, readable code over clever code. This is a learning project and other students should be able to contribute.
