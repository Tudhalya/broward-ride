import { state } from './state.js';
import { STORAGE_KEYS } from './config.js';

const STOPS_CACHE_TTL  = 24 * 60 * 60 * 1000;
const ROUTES_CACHE_TTL = 24 * 60 * 60 * 1000;

export async function apiFetch(path) {
  const res = await fetch(path);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}: server returned non-JSON`);
  }
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

  const errs = [];
  if (posRes.status  === 'rejected') errs.push(posRes.reason.message);
  if (state.stop && etaRes.status   === 'rejected') errs.push('ETA unavailable');
  if (state.stop && schedRes.status === 'rejected') errs.push('schedule unavailable');
  state.error = errs.length ? errs.join('; ') : null;

  state.lastUpdate = new Date();
}

function getFromCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function saveToCache(key, data, ttl) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + ttl }));
  } catch { /* ignore QuotaExceededError — still works, just not cached */ }
}

export async function loadRoutes() {
  const cached = getFromCache(STORAGE_KEYS.routes);
  if (cached) {
    state.routes = cached;
    return;
  }
  try {
    const routes = await apiFetch('/api/routes');
    state.routes = routes;
    saveToCache(STORAGE_KEYS.routes, routes, ROUTES_CACHE_TTL);
  } catch (err) {
    console.error('Failed to load routes:', err);
  }
}

export async function loadStops() {
  if (state.stopsRoute === state.routeKey && state.stops.length) return;

  const cacheKey = STORAGE_KEYS.stopsPrefix + state.routeKey;
  const cached   = getFromCache(cacheKey);
  if (cached) {
    state.stops      = cached;
    state.stopsRoute = state.routeKey;
    return;
  }

  try {
    const stops      = await apiFetch(`/api/stops?route=${encodeURIComponent(state.routeKey)}`);
    state.stops      = stops;
    state.stopsRoute = state.routeKey;
    saveToCache(cacheKey, stops, STOPS_CACHE_TTL);
  } catch (err) {
    console.error('Failed to load stops:', err);
    state.stops      = [];
    state.stopsRoute = state.routeKey;
  }
}
