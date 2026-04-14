'use strict';

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Config ────────────────────────────────────────────────────────────────────
const REFRESH_SEC    = 30;
const BROWARD_CENTER = [26.12, -80.15]; // Broward County, FL
const BROWARD_ZOOM   = 11;

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  routeKey:   'BCT109_North',  // Id from routes API (= route key used in all API calls)
  stop:       '6250',
  routes:     [],              // full route list from /api/routes
  positions:  [],
  eta:        [],
  schedule:   [],
  loading:    false,
  error:      null,
  lastUpdate: null,
  ctrlsOpen:  true,
  activeTab:  'live',
  mapFitted:  false,
};

// ── Map ───────────────────────────────────────────────────────────────────────
let map, routeLayer, busLayer;

const MAP_VIEW_KEY = 'broward_map_view';

function getSavedMapView() {
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMapView() {
  try {
    const c = map.getCenter();
    localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
  } catch {}
}

function initMap() {
  const saved  = getSavedMapView();
  const center = saved ? saved.center : BROWARD_CENTER;
  const zoom   = saved ? saved.zoom   : BROWARD_ZOOM;

  map = L.map('map', { center, zoom });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  map.on('moveend', saveMapView);

  routeLayer = L.layerGroup().addTo(map);  // polyline drawn below buses
  busLayer   = L.layerGroup().addTo(map);
}

// Decode Google Encoded Polyline (https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
function decodePolyline(enc) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < enc.length) {
    let b, s = 0, n = 0;
    do { b = enc.charCodeAt(i++) - 63; n |= (b & 31) << s; s += 5; } while (b >= 32);
    lat += n & 1 ? ~(n >> 1) : n >> 1;
    n = 0; s = 0;
    do { b = enc.charCodeAt(i++) - 63; n |= (b & 31) << s; s += 5; } while (b >= 32);
    lng += n & 1 ? ~(n >> 1) : n >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

function renderMap() {
  busLayer.clearLayers();
  routeLayer.clearLayers();

  const route = state.routes.find((r) => r.Id === state.routeKey);
  const color  = route ? `#${escapeHTML(route.Color)}` : '#0d9488';
  const routeNum = state.routeKey.replace(/^BCT(\d+).*/, '$1');

  // ── Draw route polyline ──────────────────────────────────────────────────
  if (route?.Shp) {
    const pts = decodePolyline(route.Shp);
    L.polyline(pts, { color, weight: 4, opacity: 0.55 }).addTo(routeLayer);

    if (!state.mapFitted) {
      map.fitBounds(pts, { padding: [48, 48] });
      state.mapFitted = true;
    }
  }

  // ── Draw bus markers ─────────────────────────────────────────────────────
  const validPos = state.positions.filter(
    (v) => isFinite(v.Latitude) && isFinite(v.Longitude)
  );

  validPos.forEach((v) => {
    const ll = [v.Latitude, v.Longitude];

    const icon = L.divIcon({
      className:  '',
      html:       `<div class="bus-dot" style="background:${color}">${routeNum}</div>`,
      iconSize:   [38, 38],
      iconAnchor: [19, 19],
      popupAnchor:[0, -20],
    });

    const updated   = new Date(v.LastPositionUpdate);
    const minsAgo   = Math.max(0, Math.round((Date.now() - updated) / 60_000));
    const freshness = minsAgo <= 1 ? 'just now' : `${minsAgo} min ago`;
    const label     = route ? `${routeNum} ${escapeHTML(route.GeoDirection)}` : escapeHTML(state.routeKey);

    L.marker(ll, { icon })
     .bindPopup(`<b>Bus #${escapeHTML(String(v.Id))}</b><br>Route ${label}<br><small>GPS updated ${freshness}</small>`)
     .addTo(busLayer);
  });

  // Fallback fit to buses if no route shape was available
  if (!state.mapFitted && validPos.length) {
    const lls = validPos.map((v) => [v.Latitude, v.Longitude]);
    lls.length === 1
      ? map.setView(lls[0], Math.max(map.getZoom(), 14))
      : map.fitBounds(lls, { padding: [48, 48], maxZoom: 15 });
    state.mapFitted = true;
  }
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res  = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadAll() {
  const routeDir = state.routeKey.replace(/^BCT/, '');  // "BCT109_North" → "109_North"

  state.loading = true;
  renderStatus();

  const [posRes, etaRes, schedRes] = await Promise.allSettled([
    apiFetch(`/api/positions?route=${encodeURIComponent(state.routeKey)}`),

    state.stop
      ? apiFetch(`/api/eta?stop=${encodeURIComponent(state.stop)}&routeDirection=${encodeURIComponent(routeDir)}`)
      : Promise.resolve([]),

    state.stop
      ? apiFetch(`/api/schedule?route=${encodeURIComponent(state.routeKey)}&stop=${encodeURIComponent(state.stop)}`)
      : Promise.resolve([]),
  ]);

  state.positions = (posRes.status  === 'fulfilled' && Array.isArray(posRes.value))  ? posRes.value  : [];
  state.eta       = (etaRes.status  === 'fulfilled' && Array.isArray(etaRes.value))  ? etaRes.value  : [];
  state.schedule  = (schedRes.status === 'fulfilled' && Array.isArray(schedRes.value)) ? schedRes.value : [];

  state.error     = posRes.status === 'rejected' ? posRes.reason.message : null;
  state.lastUpdate = new Date();
  state.loading   = false;
}

// ── Time helpers ──────────────────────────────────────────────────────────────
// The API returns local Eastern time without a timezone suffix in EstimatedDeparture.
// We append -04:00 (EDT) so Date can parse it correctly regardless of client timezone.
function toEastern(isoStr) {
  if (!isoStr) return null;
  const hasZone = /[-+]\d{2}:\d{2}$|Z$/.test(isoStr);
  return new Date(hasZone ? isoStr : isoStr + '-04:00');
}

function minsUntil(isoStr) {
  const d = toEastern(isoStr);
  return d ? Math.round((d - Date.now()) / 60_000) : null;
}

function fmtTime(isoStr) {
  const d = toEastern(isoStr);
  if (!d) return isoStr;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

// DepartureTime from schedule is "HH:MM" (24-hour) — convert to 12-hour display
function fmtHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderStatus() {
  const el      = document.getElementById('status-text');
  const overlay = document.getElementById('loading-overlay');

  if (state.loading) {
    el.className    = 'loading';
    el.textContent  = 'Loading…';
    overlay.classList.add('show');
    return;
  }

  overlay.classList.remove('show');

  if (state.error) {
    el.className   = 'error';
    el.textContent = `Error: ${state.error}`;
    return;
  }

  const route = state.routes.find((r) => r.Id === state.routeKey);
  const label = route
    ? `${Number(route.SName)} ${route.GeoDirection}`
    : state.routeKey.replace(/^BCT/, '').replace('_', ' ');
  const n = state.positions.length;
  el.className   = 'ok';
  el.textContent = n
    ? `${n} bus${n !== 1 ? 'es' : ''} on route ${label}`
    : `No buses found on route ${label}`;
}

function renderETA() {
  const el = document.getElementById('tab-live');

  if (!state.stop) {
    el.innerHTML = '<p class="hint">Enter a Stop ID to see real-time arrivals</p>';
    return;
  }
  if (!state.eta.length) {
    el.innerHTML = '<p class="hint">No real-time predictions for this stop right now</p>';
    return;
  }

  el.innerHTML = state.eta.map((e) => {
    const mins     = minsUntil(e.EstimatedDeparture);
    const timeStr  = escapeHTML(fmtTime(e.EstimatedDeparture));
    const minsCls  = mins == null ? '' : mins <= 2 ? 'now' : mins <= 5 ? 'soon' : '';
    const minsText = mins == null ? '–' : mins <= 0 ? 'Now' : `${mins} min`;
    const badge    = escapeHTML((e.RouteDirection || '').replace('_', ' '));

    return `<div class="eta-item">
      <span class="eta-badge">${badge}</span>
      <span class="eta-time">${timeStr}</span>
      <span class="eta-mins ${minsCls}">${minsText}</span>
    </div>`;
  }).join('');
}

function renderSchedule() {
  const el = document.getElementById('tab-sched');

  if (!state.stop) {
    el.innerHTML = '<p class="hint">Enter a Stop ID to see the schedule</p>';
    return;
  }
  if (!state.schedule.length) {
    el.innerHTML = '<p class="hint">No upcoming scheduled departures found</p>';
    return;
  }

  el.innerHTML = state.schedule.map((s) => `
    <div class="sched-item">
      <span class="sched-time">${escapeHTML(fmtHHMM(s.DepartureTime))}</span>
      <span class="sched-sign">${escapeHTML(s.TripHeadSign || '')}</span>
    </div>
  `).join('');
}

function renderAll() {
  renderStatus();
  renderMap();
  renderETA();
  renderSchedule();
}

// ── Countdown timer ───────────────────────────────────────────────────────────
let countdownTimer = null;
let countdownVal   = REFRESH_SEC;

function startCountdown() {
  clearInterval(countdownTimer);
  countdownVal = REFRESH_SEC;
  updateCountdownEl();

  countdownTimer = setInterval(() => {
    countdownVal--;
    if (countdownVal > 0) {
      updateCountdownEl();
    } else {
      clearInterval(countdownTimer);
      document.getElementById('countdown').textContent = '↻ refreshing';
      refresh();
    }
  }, 1_000);
}

function updateCountdownEl() {
  document.getElementById('countdown').textContent = `↻ ${countdownVal}s`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-live').classList.toggle('hidden',  tab !== 'live');
  document.getElementById('tab-sched').classList.toggle('hidden', tab !== 'sched');
  document.getElementById('tab-live-btn').classList.toggle('active',  tab === 'live');
  document.getElementById('tab-sched-btn').classList.toggle('active', tab === 'sched');
}

// ── Controls toggle ───────────────────────────────────────────────────────────
function toggleControls() {
  state.ctrlsOpen = !state.ctrlsOpen;
  document.getElementById('controls').classList.toggle('collapsed', !state.ctrlsOpen);
  // Let Leaflet know the map size changed after CSS transition
  setTimeout(() => map && map.invalidateSize(), 270);
}

// ── Track ─────────────────────────────────────────────────────────────────────
const TRACK_COOLDOWN_SEC = 5;
let trackCooldownId = null;

function startTrackCooldown() {
  const btn = document.querySelector('.track-btn');
  let remaining = TRACK_COOLDOWN_SEC;
  btn.disabled    = true;
  btn.textContent = `${remaining}s`;
  trackCooldownId = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(trackCooldownId);
      trackCooldownId     = null;
      btn.disabled        = false;
      btn.textContent     = 'Track';
    } else {
      btn.textContent = `${remaining}s`;
    }
  }, 1_000);
}

function track() {
  if (trackCooldownId) return;

  const newKey = document.getElementById('route-select').value;

  if (newKey && newKey !== state.routeKey) state.mapFitted = false;
  if (newKey) state.routeKey = newKey;

  state.stop = document.getElementById('stop-input').value.trim();

  if (window.innerWidth < 480 && state.ctrlsOpen) toggleControls();

  startTrackCooldown();
  refresh();
}

// ── Routes local cache ────────────────────────────────────────────────────────
const ROUTES_CACHE_KEY = 'broward_routes_v1';
const ROUTES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

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

// ── Routes ────────────────────────────────────────────────────────────────────
async function loadRoutes() {
  const cached = getRoutesFromCache();
  if (cached) {
    state.routes = cached;
    populateRouteSelect();
    return;
  }
  try {
    const routes = await apiFetch('/api/routes');
    state.routes = routes;
    populateRouteSelect();
    saveRoutesToCache(routes);
  } catch (err) {
    console.error('Failed to load routes:', err);
    // Select stays with the placeholder; user can still track manually
  }
}

function populateRouteSelect() {
  const sel = document.getElementById('route-select');
  sel.innerHTML = '';

  // Group routes by SName (route number)
  const groups = {};
  state.routes.forEach((r) => {
    (groups[r.SName] = groups[r.SName] || []).push(r);
  });

  const dirLabel = { North: 'Northbound', South: 'Southbound',
                     East: 'Eastbound',   West: 'Westbound',
                     Clockwise: 'Clockwise', Counterclockwise: 'Counterclockwise' };

  Object.keys(groups)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((num) => {
      const routes = groups[num];
      const grp    = document.createElement('optgroup');
      const lname  = routes[0].LName;
      grp.label    = `${Number(num)} — ${lname.length > 38 ? lname.slice(0, 36) + '…' : lname}`;

      routes.forEach((r) => {
        const opt      = document.createElement('option');
        opt.value      = r.Id;
        opt.textContent = dirLabel[r.GeoDirection] || r.GeoDirection;
        opt.selected   = r.Id === state.routeKey;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });
}

// ── Refresh ───────────────────────────────────────────────────────────────────
async function refresh() {
  await loadAll();
  renderAll();
  startCountdown();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.stop = document.getElementById('stop-input').value;

  initMap();

  document.getElementById('stop-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') track();
  });

  // Give Leaflet one frame to measure container, then load routes + first refresh
  requestAnimationFrame(() => {
    map.invalidateSize();
    loadRoutes();   // populates dropdown; routes are cached 24 h server-side
    refresh();      // starts tracking the default route immediately
  });
});
