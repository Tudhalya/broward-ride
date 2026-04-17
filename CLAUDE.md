# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies (uses bun.lock)
npm run dev       # Start backend + browser-sync hot reload (port 3080, proxy 3080)
npm start         # Production server on $PORT (default 3080)
```

No build step — vanilla JS served directly from `/public`.

## Environment

Create `.env` from `.env.example`:
```
PORT=3080
BCT_API=https://myride2.broward.org/TransitAPICore
```

## Architecture

**Backend** (`server.js`): Express proxy with in-memory caching (`Map`) sitting between the browser and the upstream Broward County Transit API (`myride2.broward.org`). The upstream API requires a spoofed iOS Safari User-Agent. All `/api/*` endpoints cache responses with different TTLs:
- Routes, stops, schedules: 30-day TTL
- Bus positions, ETAs: 30-second TTL

Rate limiting: 5 req/min for large-payload endpoints, 30 req/min for live endpoints.

**Frontend** (`public/`): Vanilla JS ES modules, no framework, no build step.

| Module | Role |
|--------|------|
| `main.js` | App init, event wiring, refresh loop orchestration |
| `state.js` | Single shared state object (routes, positions, ETAs, stops) |
| `api.js` | `apiFetch()` wrapper with localStorage caching |
| `map.js` | Leaflet map, bus markers, route polylines, stop circles |
| `ui.js` | DOM rendering for status bar, ETA/schedule tabs, modals |
| `config.js` | Constants: `REFRESH_SEC`, `BROWARD_CENTER`, `DIR_LABEL` |
| `utils.js` | `escapeHTML()`, time formatting, timezone helpers |

**Data flow**: User selects route/stop → `track()` saves to localStorage → `refresh()` calls `Promise.allSettled` for positions + ETA + schedule in parallel → `state.js` updated → `renderAll()` updates DOM and Leaflet layers → `startCountdown()` re-runs `refresh()` every 30 seconds.

**CSS**: Embedded in `index.html` `<style>` block (kept inline for PWA simplicity — no separate stylesheet).

## Adding Features

- New API endpoint: add to `server.js` with caching pattern matching existing endpoints
- Call from frontend: use `apiFetch()` in `api.js`
- New state: add field to `state.js` object
- Render: add to `ui.js` or `map.js`; call from `renderAll()` in `main.js`
- Constants: add to `config.js`

## Deployment

GitHub Actions (`.github/workflows/deploy.yaml`) auto-deploys to Fly.io on push to main. Requires `FLY_API_TOKEN` secret. Manual deploy: `fly deploy`.
