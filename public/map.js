import { BROWARD_CENTER, BROWARD_ZOOM, STORAGE_KEYS } from './config.js';
import { state } from './state.js';
import { escapeHTML } from './utils.js';

const HEX_RE = /^[0-9a-f]{6}$/i;
function safeColor(raw) {
  return raw && HEX_RE.test(raw) ? `#${raw}` : '#0d9488';
}

let map, routeLayer, stopLayer, busLayer;

function getSavedMapView() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.mapView);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMapView() {
  try {
    const c = map.getCenter();
    localStorage.setItem(STORAGE_KEYS.mapView, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
  } catch {}
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

export function initMap() {
  const saved  = getSavedMapView();
  const center = saved ? saved.center : BROWARD_CENTER;
  const zoom   = saved ? saved.zoom   : BROWARD_ZOOM;

  if (saved) state.mapFitted = true;

  map = L.map('map', { center, zoom });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  map.on('moveend', saveMapView);

  routeLayer = L.layerGroup().addTo(map);
  stopLayer  = L.layerGroup().addTo(map);
  busLayer   = L.layerGroup().addTo(map);
}

export function invalidateMap() {
  if (map) map.invalidateSize();
}

export function clearStopLayer() {
  if (stopLayer) stopLayer.clearLayers();
}

export function renderMap() {
  busLayer.clearLayers();
  routeLayer.clearLayers();

  const route    = state.routes.find((r) => r.Id === state.routeKey);
  const color    = safeColor(route?.Color);
  const routeNum = state.routeKey.replace(/^BCT(\d+).*/, '$1');

  if (route?.Shp) {
    const pts = decodePolyline(route.Shp);
    L.polyline(pts, { color, weight: 4, opacity: 0.55 }).addTo(routeLayer);

    if (!state.mapFitted) {
      map.fitBounds(pts, { padding: [48, 48] });
      state.mapFitted = true;
    }
  }

  const validPos = state.positions.filter(
    (v) => isFinite(v.Latitude) && isFinite(v.Longitude)
  );

  validPos.forEach((v) => {
    const ll   = [v.Latitude, v.Longitude];
    const icon = L.divIcon({
      className:   '',
      html:        `<div class="bus-dot" style="background:${color}">${routeNum}</div>`,
      iconSize:    [38, 38],
      iconAnchor:  [19, 19],
      popupAnchor: [0, -20],
    });

    const updated   = new Date(v.LastPositionUpdate);
    const minsAgo   = Math.max(0, Math.round((Date.now() - updated) / 60_000));
    const freshness = minsAgo <= 1 ? 'just now' : `${minsAgo} min ago`;
    const label     = route ? `${routeNum} - ${escapeHTML(route.GeoDirection)}` : escapeHTML(state.routeKey);

    L.marker(ll, { icon })
     .bindPopup(`<b>Bus #${escapeHTML(String(v.Id))}</b><br>Route ${label}<br><small>GPS updated ${freshness}</small>`)
     .addTo(busLayer);
  });

  if (!state.mapFitted && validPos.length) {
    const lls = validPos.map((v) => [v.Latitude, v.Longitude]);
    lls.length === 1
      ? map.setView(lls[0], Math.max(map.getZoom(), 14))
      : map.fitBounds(lls, { padding: [48, 48], maxZoom: 15 });
    state.mapFitted = true;
  }
}

export function renderStops() {
  stopLayer.clearLayers();

  if (!state.stops.length) return;

  const route = state.routes.find((r) => r.Id === state.routeKey);
  const color  = safeColor(route?.Color);

  state.stops.forEach((stop) => {
    const isSelected = stop.Code === state.stop;
    L.circleMarker([stop.LatLng.Latitude, stop.LatLng.Longitude], {
      radius:      isSelected ? 7 : 5,
      color,
      fillColor:   isSelected ? color : '#ffffff',
      fillOpacity: 1,
      weight:      2,
      opacity:     0.85,
    })
    .bindPopup(`<b>${escapeHTML(stop.Name)}</b><br>Stop #${escapeHTML(stop.Code)}<br><small>Click to track this stop</small>`)
    .on('click', () => {
      document.dispatchEvent(new CustomEvent('broward:stop-selected', { detail: { code: stop.Code } }));
    })
    .addTo(stopLayer);
  });
}
