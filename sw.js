/**
 * sw.js — HF Band Scout Service Worker
 *
 * Caching strategy:
 *  - App shell (HTML/CSS/JS/data): Cache-first with network fallback
 *  - NOAA API responses:           Network-first with cache fallback (15 min TTL)
 *  - Leaflet tiles:                Cache-first (stale-while-revalidate)
 */

const APP_VERSION   = 'v1.9.1';
const SHELL_CACHE   = `hfbs-shell-${APP_VERSION}`;
const TILE_CACHE    = `hfbs-tiles-${APP_VERSION}`;
const NOAA_CACHE    = `hfbs-noaa-${APP_VERSION}`;

const NOAA_TTL_MS   = 15 * 60 * 1000; // 15 minutes
const TILE_MAX      = 500;             // max cached map tiles

// App shell assets to pre-cache on install
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/map.css',
  './css/timeline.css',
  './css/drilldown.css',
  './css/listview.css',
  './css/opening.css',
  './css/setup.css',
  './js/app.js',
  './js/state.js',
  './js/utils.js',
  './js/propagation.js',
  './js/i18n.js',
  './js/noaa.js',
  './js/map.js',
  './js/timeline.js',
  './js/drilldown.js',
  './js/listview.js',
  './js/opening.js',
  './js/settings.js',
  './js/cache.js',
  './js/wspr.js',
  './js/bandplan.js',
  './data/dxcc.geojson',
  './data/radio-profiles.json',
  './data/i18n/en.json',
  './data/i18n/nl.json',
  './data/i18n/fr.json',
  './data/i18n/de.json',
  './data/i18n/es.json',
  './lib/leaflet/leaflet.js',
  './lib/leaflet/leaflet.css',
  './lib/suncalc.js',
];

const NOAA_ORIGINS = [
  'https://services.swpc.noaa.gov',
];

// Live-data origins die NOOIT gecachet mogen worden (altijd netwerk)
const LIVE_ONLY_ORIGINS = [
  'https://db1.wspr.live',
];

const TILE_ORIGINS = [
  'https://tile.openstreetmap.org',
  'https://{a,b,c}.tile.openstreetmap.org',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      // Add files one by one so a missing optional file doesn't fail everything
      return Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Could not cache ${url}:`, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => ![SHELL_CACHE, TILE_CACHE, NOAA_CACHE].includes(k))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // NOAA API → network-first with cache fallback + TTL
  if (NOAA_ORIGINS.some(o => url.origin === o)) {
    event.respondWith(noaaStrategy(request));
    return;
  }

  // Live-data (wspr.live) → altijd netwerk, nooit cachen
  if (LIVE_ONLY_ORIGINS.some(o => url.origin === o)) {
    event.respondWith(fetch(request));
    return;
  }

  // Map tiles → cache-first (stale-while-revalidate)
  if (isTileRequest(url)) {
    event.respondWith(tileStrategy(request));
    return;
  }

  // Everything else (app shell) → cache-first
  event.respondWith(shellStrategy(request));
});

// ─── Strategies ──────────────────────────────────────────────────────────
async function shellStrategy(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline fallback for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('./index.html', { cacheName: SHELL_CACHE });
    }
    return new Response('Offline', { status: 503 });
  }
}

async function noaaStrategy(request) {
  const cache = await caches.open(NOAA_CACHE);

  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      // Store with timestamp header
      const ts   = Date.now().toString();
      const body = await response.clone().arrayBuffer();
      const hdrs = new Headers(response.headers);
      hdrs.set('x-sw-cached-at', ts);
      const stamped = new Response(body, {
        status:  response.status,
        headers: hdrs,
      });
      cache.put(request, stamped);
      return new Response(body, { status: response.status, headers: response.headers });
    }
    // Non-OK → fall through to cache
  } catch {
    // Network error → fall through to cache
  }

  const cached = await cache.match(request);
  if (cached) {
    const cachedAt = Number(cached.headers.get('x-sw-cached-at') ?? 0);
    const age      = Date.now() - cachedAt;
    if (age < NOAA_TTL_MS * 4) { // allow stale up to 1 hour
      return cached;
    }
  }

  return new Response(JSON.stringify({ error: 'offline', cached: false }), {
    status:  503,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function tileStrategy(request) {
  const cache  = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Evict oldest tile if at limit
      await evictTiles(cache);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isTileRequest(url) {
  return (
    url.pathname.match(/\/\d+\/\d+\/\d+\.png$/) ||
    url.hostname.includes('tile.openstreetmap.org')
  );
}

async function evictTiles(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length >= TILE_MAX) {
      // Delete oldest 10%
      const toDelete = keys.slice(0, Math.ceil(TILE_MAX * 0.1));
      await Promise.all(toDelete.map(k => cache.delete(k)));
    }
  } catch { /* ignore */ }
}

// ─── Message handler (e.g. skipWaiting from app) ──────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_TILE_CACHE') {
    caches.delete(TILE_CACHE).catch(() => {});
  }
});
