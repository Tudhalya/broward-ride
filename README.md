# Broward Ride

An unofficial, community-made real-time tracker for **Broward County Transit (BCT)** buses — built after the MyRide app was discontinued in February 2026.

> **Disclaimer:** This project is not affiliated with, endorsed by, or operated by Broward County or Broward County Transit. Transit data is sourced from the BCT API and may be delayed or inaccurate. Use for informational purposes only. For official information, visit [broward.org/BCT](https://www.broward.org/BCT).

---

## Features

- Live bus positions on an interactive map, updated every 30 seconds
- Real-time ETAs for a selected stop
- Scheduled departure times
- Full route list with shapes and stop data
- Mobile-first, installable as a PWA
- No login, no account, no tracking

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, [Leaflet.js](https://leafletjs.com/) |
| Backend | Node.js, Express |
| Security | Helmet, express-rate-limit |
| Maps | OpenStreetMap / CARTO tiles |
| Deployment | Docker |

## Getting started

### Prerequisites

- Node.js 20+

### Run locally

```bash
bun install
bun run dev
```

Opens at `http://localhost:5080`. The `dev` script uses hot-reload via browser-sync.

### Environment variables

Create a `.env` file (optional — defaults work out of the box):

```
PORT=5080
BCT_API=https://myride2.broward.org/TransitAPICore
```

### Run with Docker

```bash
docker build -t broward-ride .
docker run -p 5080:5080 broward-ride
```

## API

The server proxies BCT data and exposes these endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/routes` | All routes with shapes and stop lists (cached 30 days) |
| `GET /api/positions?route=BCT109_North` | Live vehicle positions (cached 30 s) |
| `GET /api/eta?stop=6250&routeDirection=109_North` | Real-time ETAs (cached 30 s) |
| `GET /api/schedule?route=BCT109_North&stop=6250` | Scheduled departures (cached 30 days) |
| `GET /api/health` | Server health check |

## Notes on the upstream API

The BCT API at `myride2.broward.org` was the backend for the official MyRide mobile app. It has no published terms of use for third-party access. This app uses it solely to surface public transit data for personal, non-commercial use. If BCT changes or restricts the API, this app may stop working.

## License

[MIT](LICENSE.md) — Copyright (c) 2026 Tudhalya
