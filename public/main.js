import { TRACK_COOLDOWN_SEC, STORAGE_KEYS } from './config.js';
import { state } from './state.js';
import { loadAll, loadRoutes, loadStops } from './api.js';
import { initMap, clearStopLayer, invalidateMap } from './map.js';
import {
  renderAll, renderStatus, populateRouteSelect, updateRouteDisplay,
  setTab, toggleControls, openAbout, closeAbout, startCountdown,
} from './ui.js';

function getSavedSelection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.selection)) || null; }
  catch { return null; }
}

function saveSelection() {
  try { localStorage.setItem(STORAGE_KEYS.selection, JSON.stringify({ routeKey: state.routeKey, stop: state.stop })); }
  catch {}
}

async function refresh() {
  state.loading = true;
  renderStatus();
  try {
    await Promise.all([loadStops(), loadAll()]);
  } catch (err) {
    console.error('Refresh failed:', err);
    state.error = err.message;
  } finally {
    state.loading = false;
  }
  renderAll();
  startCountdown(refresh);
}

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
      trackCooldownId = null;
      btn.disabled    = false;
      btn.textContent = 'Track';
    } else {
      btn.textContent = `${remaining}s`;
    }
  }, 1_000);
}

function track() {
  if (trackCooldownId) return;

  const newKey = document.getElementById('route-select').value;

  if (newKey && newKey !== state.routeKey) {
    state.mapFitted  = false;
    state.stopsRoute = null;
    clearStopLayer();
  }
  if (newKey) { state.routeKey = newKey; updateRouteDisplay(); }

  state.stop = document.getElementById('stop-input').value.trim();

  saveSelection();

  if (window.innerWidth < 480 && state.ctrlsOpen) toggleControls();

  startTrackCooldown();
  refresh();
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = getSavedSelection();
  if (saved) {
    state.routeKey = saved.routeKey;
    state.stop     = saved.stop;
  } else {
    state.stop = document.getElementById('stop-input').value;
  }
  document.getElementById('stop-input').value = state.stop;

  initMap();

  document.getElementById('about-btn').addEventListener('click', openAbout);
  document.getElementById('about-close-btn').addEventListener('click', closeAbout);
  document.getElementById('about-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAbout();
  });
  document.getElementById('toggle-btn').addEventListener('click', toggleControls);
  document.getElementById('track-btn').addEventListener('click', track);
  document.getElementById('tab-live-btn').addEventListener('click', () => setTab('live'));
  document.getElementById('tab-sched-btn').addEventListener('click', () => setTab('sched'));

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAbout(); });

  document.getElementById('stop-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') track();
  });

  document.getElementById('route-select').addEventListener('change', function () {
    updateRouteDisplay(this.value);
    this.blur();
  });

  document.addEventListener('broward:stop-selected', (e) => {
    document.getElementById('stop-input').value = e.detail.code;
    state.stop = e.detail.code;
    refresh();
  });

  // Give Leaflet one frame to measure container, then load routes + first refresh
  requestAnimationFrame(() => {
    invalidateMap();
    loadRoutes().then(populateRouteSelect);
    refresh();
  });
});
