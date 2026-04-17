'use strict';

require('dotenv').config();

const express    = require('express');
const https      = require('https');
const path       = require('path');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 5080;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", 'https://unpkg.com'],
      styleSrc:       ["'self'", 'https://unpkg.com', "'unsafe-inline'"], // unsafe-inline needed for Leaflet divIcon style attributes
      imgSrc:         ["'self'", 'https://unpkg.com', 'https://*.basemaps.cartocdn.com', 'data:'],
      connectSrc:     ["'self'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiterBase = {
  windowMs:       60_000,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { error: 'Too many requests — please slow down.' },
};

// /api/routes and /api/stops return large payloads; localStorage cache means a
// legitimate client only needs each once per 24 h session.
app.use('/api/routes', rateLimit({ ...limiterBase, max: 5 }));
app.use('/api/stops',  rateLimit({ ...limiterBase, max: 5 }));

// Live endpoints: frontend auto-polls every 30 s (3 calls/poll = 6 req/min).
// 30 req/min gives ~5× headroom for manual refreshes and multiple tabs.
app.use('/api', rateLimit({ ...limiterBase, max: 30 }));

const BCT_API   = process.env.BCT_API || 'https://myride2.broward.org/TransitAPICore';
// The API only responds to mobile user-agents (originally served the MyRide mobile app)
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const TTL_LIVE   = 30_000;          // 30 s  – vehicle positions & ETAs
const TTL_SCHED  = 30 * 24 * 3_600_000;  // 30 days – static schedule
const TTL_ROUTES = 30 * 24 * 3_600_000;  // 30 days  – route shapes / stop lists

// ── In-memory cache ──────────────────────────────────────────────────────────
const cache         = new Map();
const MAX_CACHE_SIZE = 500;

function getCache(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.exp) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data, ttl) {
  // Evict oldest entry when at capacity (Map preserves insertion order)
  if (cache.size >= MAX_CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(key, { data, exp: Date.now() + ttl });
}

// ── Upstream fetch ────────────────────────────────────────────────────────────
// Supports GET and POST. Pass `body` (plain object) to send a JSON POST request.
function fetchJSON(url, { body, timeout = 8_000 } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj   = new URL(url);
    const bodyStr  = body ? JSON.stringify(body) : null;
    const options  = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   bodyStr ? 'POST' : 'GET',
      headers:  {
        'User-Agent': MOBILE_UA,
        Accept:       'application/json',
        ...(bodyStr && {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        }),
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Upstream returned HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Upstream returned non-JSON')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Request timed out')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Proxy helper ──────────────────────────────────────────────────────────────
function proxy(ttl, buildUrl) {
  return async (req, res) => {
    // Validate params and build upstream URL
    let upstreamUrl;
    try { upstreamUrl = buildUrl(req.query); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    const cacheKey = req.url;
    const cached   = getCache(cacheKey);
    if (cached) {
      console.log(`CACHE HIT  ${req.url}`);
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    console.log(`FETCH      ${upstreamUrl}`);
    try {
      const data = await fetchJSON(upstreamUrl);
      setCache(cacheKey, data, ttl);
      res.set('Cache-Control', `max-age=${Math.floor(ttl / 1000)}`);
      res.json(data);
    } catch (err) {
      console.error(`ERROR      ${req.url} — ${err.message}`);
      res.status(502).json({ error: err.message });
    }
  };
}

// ── API routes ────────────────────────────────────────────────────────────────

// GET /api/positions?route=BCT109_North
app.get('/api/positions', proxy(TTL_LIVE, ({ route }) => {
  if (!route) throw new Error('route parameter required (e.g. BCT109_North)');
  return `${BCT_API}/VehiclePosition/GetPositionsForRoute?route_direction_key=${encodeURIComponent(route)}`;
}));

// GET /api/schedule?route=BCT109_North&stop=6250
app.get('/api/schedule', proxy(TTL_SCHED, ({ route, stop }) => {
  if (!route) throw new Error('route parameter required');
  if (!stop)  throw new Error('stop parameter required');
  return `${BCT_API}/Schedules/GetNextSchedule?Route=${encodeURIComponent(route)}&stop=${encodeURIComponent(stop)}`;
}));

// GET /api/eta?stop=6250&routeDirection=109_North
app.get('/api/eta', proxy(TTL_LIVE, ({ stop, routeDirection }) => {
  if (!stop)           throw new Error('stop parameter required');
  if (!routeDirection) throw new Error('routeDirection parameter required (e.g. 109_North)');
  return `${BCT_API}/ETA/GetStopRoutePredictionsForWeb?stop=${encodeURIComponent(stop)}&routeDirection=${encodeURIComponent(routeDirection)}`;
}));

// GET /api/routes  — full route list with shapes, cached 24 h
app.get('/api/routes', async (_req, res) => {
  const cacheKey = '/api/routes';
  const cached   = getCache(cacheKey);
  if (cached) {
    console.log('CACHE HIT  /api/routes');
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  console.log('FETCH      routes (POST)');
  try {
    const data = await fetchJSON(`${BCT_API}/Routes/`, {
      body:    { AgencyID: 'BCT' },
      timeout: 15_000,  // larger payload, give it more time
    });
    setCache(cacheKey, data, TTL_ROUTES);
    res.set('Cache-Control', `max-age=${Math.floor(TTL_ROUTES / 1000)}`);
    res.json(data);
  } catch (err) {
    console.error(`ERROR      routes — ${err.message}`);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/stops?route=BCT109_North  — stops for one route, filtered server-side
// Full stops list (~706 KB) is fetched once and held in cache; each per-route
// result is also cached so repeated requests for the same route are instant.
app.get('/api/stops', async (req, res) => {
  const { route } = req.query;
  if (!route) return res.status(400).json({ error: 'route parameter required (e.g. BCT109_North)' });

  const routeCacheKey = `/api/stops?route=${encodeURIComponent(route)}`;
  const cached = getCache(routeCacheKey);
  if (cached) {
    console.log(`CACHE HIT  ${routeCacheKey}`);
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Fetch full stops list if not already cached
  const ALL_STOPS_KEY = '__stops_all';
  let allStops = getCache(ALL_STOPS_KEY);
  if (!allStops) {
    console.log('FETCH      stops (POST)');
    try {
      allStops = await fetchJSON(`${BCT_API}/Stops`, {
        body:    { AgencyID: 'BCT' },
        timeout: 20_000,
      });
      setCache(ALL_STOPS_KEY, allStops, TTL_ROUTES);
    } catch (err) {
      console.error(`ERROR      stops — ${err.message}`);
      return res.status(502).json({ error: err.message });
    }
  }

  const filtered = allStops.filter(s => Array.isArray(s.Routes) && s.Routes.includes(route));
  setCache(routeCacheKey, filtered, TTL_ROUTES);
  res.set('Cache-Control', `max-age=${Math.floor(TTL_ROUTES / 1000)}`);
  res.json(filtered);
});

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', cacheEntries: cache.size, uptime: Math.round(process.uptime()) });
});

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`\nBroward Ride  →  http://localhost:${PORT}\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log('All connections closed. Exiting.');
    process.exit(0);
  });
  // Force-exit if open connections don't drain within 10 s
  setTimeout(() => { console.error('Forced exit after timeout.'); process.exit(1); }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
