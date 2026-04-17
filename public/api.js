import { state } from './state.js';

const STOPS_CACHE_PREFIX = 'broward_stops_v1_';
const STOPS_CACHE_TTL    = 24 * 60 * 60 * 1000;

const ROUTES_CACHE_KEY = 'broward_routes_v1';
const ROUTES_CACHE_TTL = 24 * 60 * 60 * 1000;

export async function apiFetch(path) {
  const res  = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function loadAll() {
  const routeDir = state.routeKey.replace(/^BCT/, '');

  const [posRes, etaRes, schedRes] = await Promise.allSettled([
    apiFetch(`/api/positions?route=${encodeURIComponent(state.routeKey)}`),

    state.stop
      ? apiFetch(`/api/eta?stop=${encodeURIComponent(state.stop)}&routeDirection=${encodeURIComponent(routeDir)}`)
      : Promise.resolve([]),

    state.stop
      ? apiFetch(`/api/schedule?route=${encodeURIComponent(state.routeKey)}&stop=${encodeURIComponent(state.stop)}`)
      : Promise.resolve([]),
  ]);

  state.positions  = (posRes.status   === 'fulfilled' && Array.isArray(posRes.value))   ? posRes.value   : [];
  state.eta        = (etaRes.status   === 'fulfilled' && Array.isArray(etaRes.value))   ? etaRes.value   : [];
  state.schedule   = (schedRes.status === 'fulfilled' && Array.isArray(schedRes.value)) ? schedRes.value : [];
  state.error      = posRes.status === 'rejected' ? posRes.reason.message : null;
  state.lastUpdate = new Date();
}

function getStopsFromCache(routeKey) {
  try {
    const raw = localStorage.getItem(STOPS_CACHE_PREFIX + routeKey);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(STOPS_CACHE_PREFIX + routeKey); return null; }
    return data;
  } catch { return null; }
}

function saveStopsToCache(routeKey, data) {
  try {
    localStorage.setItem(STOPS_CACHE_PREFIX + routeKey, JSON.stringify({ data, expires: Date.now() + STOPS_CACHE_TTL }));
  } catch {}
}

function getRoutesFromCache() {
  try {
    const raw = localStorage.getItem(ROUTES_CACHE_KEY);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(ROUTES_CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function saveRoutesToCache(data) {
  try {
    localStorage.setItem(ROUTES_CACHE_KEY, JSON.stringify({ data, expires: Date.now() + ROUTES_CACHE_TTL }));
  } catch { /* ignore QuotaExceededError — still works, just not cached */ }
}

export async function loadRoutes() {
  const cached = getRoutesFromCache();
  if (cached) {
    state.routes = cached;
    return;
  }
  try {
    const routes = await apiFetch('/api/routes');
    state.routes = routes;
    saveRoutesToCache(routes);
  } catch (err) {
    console.error('Failed to load routes:', err);
  }
}

export async function loadStops() {
  if (state.stopsRoute === state.routeKey && state.stops.length) return;

  const cached = getStopsFromCache(state.routeKey);
  if (cached) {
    state.stops      = cached;
    state.stopsRoute = state.routeKey;
    return;
  }

  try {
    const stops      = await apiFetch(`/api/stops?route=${encodeURIComponent(state.routeKey)}`);
    state.stops      = stops;
    state.stopsRoute = state.routeKey;
    saveStopsToCache(state.routeKey, stops);
  } catch (err) {
    console.error('Failed to load stops:', err);
    state.stops      = [];
    state.stopsRoute = state.routeKey;
  }
}
