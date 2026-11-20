import { TRACK_COOLDOWN_SEC, STORAGE_KEYS } from './config.js';
import { state } from './state.js';
import { loadAll, loadRoutes, loadStops } from './api.js';
import { initMap, invalidateMap, locateUser } from './map.js';
import {
  renderAll, renderStatus, renderNotifyBar,
  setTab, openAbout, closeAbout, startCountdown,
} from './ui.js';
import { initRoutePicker, populateRoutePicker } from './picker.js';
import { requestPermission, checkAndNotify } from './notifications.js';

function getSavedSelection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.selection)) || null; }
  catch { return null; }
}

function saveSelection() {
  try { localStorage.setItem(STORAGE_KEYS.selection, JSON.stringify({ routeKey: state.routeKey, stop: state.stop })); }
  catch {}
}

async function refresh() {
  if (state.loading) return;
  if (state.queuedRouteKey) {
    startCountdown(refresh);
    return;
  }

  state.loading = true;
  renderStatus();
  const results = await Promise.allSettled([loadStops(), loadAll()]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) {
    console.error('Refresh failed:', failure.reason);
    state.error = failure.reason.message;
  }
  state.loading = false;

  renderAll();
  if (!state.queuedRouteKey && pendingStop === null) checkAndNotify();
  startCountdown(refresh);
  runPendingRefresh();
}

let trackCooldownId = null;
let pendingTrack = false;
let pendingStop = null;

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
      runPendingRefresh();
    } else {
      btn.textContent = `${remaining}s`;
    }
  }, 1_000);
}

function track() {
  if (trackCooldownId) return;
  pendingTrack = true;
  runPendingRefresh();
}

function runPendingRefresh() {
  if (state.loading) return;

  const tracking = pendingTrack || state.queuedRouteKey;
  if (tracking && trackCooldownId) return;
  if (!tracking && pendingStop === null) return;

  if (state.queuedRouteKey) {
    state.routeKey = state.queuedRouteKey;
    state.queuedRouteKey = null;
    state.mapFitted = false;
    state.notified.clear();
  }

  const newStop = tracking ? document.getElementById('stop-input').value.trim() : pendingStop;
  if (newStop !== state.stop) state.notified.clear();
  state.stop = newStop;
  pendingStop = null;
  pendingTrack = false;

  if (tracking) {
    saveSelection();
    startTrackCooldown();
  }
  refresh();
}

document.addEventListener('DOMContentLoaded', async () => {
  const saved = getSavedSelection();
  if (saved) {
    state.routeKey = saved.routeKey;
    state.stop     = saved.stop;
  } else {
    state.stop = document.getElementById('stop-input').value;
  }
  document.getElementById('stop-input').value = state.stop;

  await initMap();

  document.getElementById('about-btn').addEventListener('click', openAbout);
  document.getElementById('locate-btn').addEventListener('click', locateUser);
  document.getElementById('about-close-btn').addEventListener('click', closeAbout);
  document.getElementById('about-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAbout();
  });
  document.getElementById('track-btn').addEventListener('click', track);
  document.getElementById('tab-live-btn').addEventListener('click', () => setTab('live'));
  document.getElementById('tab-sched-btn').addEventListener('click', () => setTab('sched'));

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAbout(); });

  document.getElementById('stop-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') track();
  });

  initRoutePicker();

  document.addEventListener('broward:route-selected', (e) => {
    const key = e.detail.key;
    state.queuedRouteKey = key === state.routeKey ? null : key;
    runPendingRefresh();
    renderStatus();
  });

  document.addEventListener('broward:stop-selected', (e) => {
    document.getElementById('stop-input').value = e.detail.code;
    pendingStop = e.detail.code;
    runPendingRefresh();
  });

  document.getElementById('notify-toggle-btn').addEventListener('click', async () => {
    if (state.notifyMins) {
      state.notifyMins = null;
      renderNotifyBar();
    } else {
      const granted = await requestPermission();
      if (granted) {
        state.notifyMins = 5;
        renderNotifyBar();
      }
    }
  });

  document.getElementById('notify-mins-select').addEventListener('change', function () {
    state.notifyMins = Number(this.value);
  });

  // Give Leaflet one frame to measure container, then load routes + first refresh
  requestAnimationFrame(() => {
    invalidateMap();
    loadRoutes().then(populateRoutePicker);
    refresh();
  });
});
