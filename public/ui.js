import { REFRESH_SEC, DIR_LABEL } from './config.js';
import { state } from './state.js';
import { escapeHTML, minsUntil, fmtTime, fmtHHMM } from './utils.js';
import { renderMap, renderStops, invalidateMap } from './map.js';

export function renderStatus() {
  const el      = document.getElementById('status-text');
  const overlay = document.getElementById('loading-overlay');

  if (state.loading) {
    el.className   = 'loading';
    el.textContent = 'Loading…';
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

export function renderETA() {
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

export function renderSchedule() {
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

export function renderAll() {
  renderStatus();
  renderMap();
  renderStops();
  renderETA();
  renderSchedule();
}

export function populateRouteSelect() {
  const sel = document.getElementById('route-select');
  sel.innerHTML = '';

  const groups = {};
  state.routes.forEach((r) => {
    (groups[r.SName] = groups[r.SName] || []).push(r);
  });

  Object.keys(groups)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((num) => {
      const routes = groups[num];
      const grp    = document.createElement('optgroup');
      const lname  = routes[0].LName;
      grp.label    = `${Number(num)} — ${lname.length > 38 ? lname.slice(0, 36) + '…' : lname}`;

      routes.forEach((r) => {
        const opt       = document.createElement('option');
        opt.value       = r.Id;
        opt.textContent = DIR_LABEL[r.GeoDirection] || r.GeoDirection;
        opt.selected    = r.Id === state.routeKey;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });

  updateRouteDisplay();
}

export function updateRouteDisplay(routeKey = state.routeKey) {
  const el    = document.getElementById('route-display');
  const route = state.routes.find((r) => r.Id === routeKey);
  if (!el || !route) return;
  el.textContent = `${Number(route.SName)} - ${DIR_LABEL[route.GeoDirection] || route.GeoDirection}`;
}

export function setTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-live').classList.toggle('hidden',  tab !== 'live');
  document.getElementById('tab-sched').classList.toggle('hidden', tab !== 'sched');
  document.getElementById('tab-live-btn').classList.toggle('active',  tab === 'live');
  document.getElementById('tab-sched-btn').classList.toggle('active', tab === 'sched');
}

export function toggleControls() {
  state.ctrlsOpen = !state.ctrlsOpen;
  document.getElementById('controls').classList.toggle('collapsed', !state.ctrlsOpen);
  // Let Leaflet know the map size changed after CSS transition
  setTimeout(() => invalidateMap(), 270);
}

export function openAbout()  { document.getElementById('about-modal').classList.add('show'); }
export function closeAbout() { document.getElementById('about-modal').classList.remove('show'); }

let countdownTimer = null;
let countdownVal   = REFRESH_SEC;

export function startCountdown(onRefresh) {
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
      onRefresh();
    }
  }, 1_000);
}

function updateCountdownEl() {
  document.getElementById('countdown').textContent = `↻ ${countdownVal}s`;
}
