/**
 * HF Band Scout — NOAA Data Fetching
 *
 * Fetches solar data from NOAA SWPC APIs.
 * All APIs are CORS-enabled and require no auth.
 * Falls back to localStorage cache on fetch failure.
 * Updates state.noaa and the conditions bar UI.
 */

import { state } from './state.js';
import { t } from './i18n.js';
import { showToast, dataAge } from './utils.js';

// ── API endpoints ──
export const API_ENDPOINTS = [
  {
    id:  'sfi',
    name: 'Solar Flux (SFI)',
    url:  'https://services.swpc.noaa.gov/json/f107_cm_flux.json',
    ttlMs: 60 * 60 * 1000, // 1 hour
  },
  {
    id:  'kp',
    name: 'Kp Index (realtime)',
    url:  'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
    ttlMs: 15 * 60 * 1000, // 15 minutes
  },
  {
    id:  'forecast',
    name: 'Kp 3-day Forecast',
    url:  'https://services.swpc.noaa.gov/text/3-day-geomag-forecast.txt',
    ttlMs: 3 * 60 * 60 * 1000, // 3 hours
  },
  {
    id:  'alerts',
    name: 'Space Weather Alerts',
    url:  'https://services.swpc.noaa.gov/products/alerts.json',
    ttlMs: 15 * 60 * 1000, // 15 minutes
  },
];

const CACHE_KEY = 'hfbs_noaa_cache';

// ── Public API ──

/**
 * Fetch all NOAA data sources in parallel.
 * On failure, fall back to cache and mark as stale.
 * Updates state.noaa and triggers UI update.
 *
 * @returns {Promise<void>}
 */
export async function fetchAll() {
  try {
    const [sfi, kp, forecast, alerts] = await Promise.all([
      fetchSFI(),
      fetchKp(),
      fetchForecast(),
      fetchAlerts(),
    ]);

    state.noaa = {
      kp,
      sfi,
      kpForecast: forecast,
      alerts,
      fetchedAt: Date.now(),
      stale: false,
    };

    saveCache();
    updateConditionsUI();
    updateAlertsUI();
  } catch (err) {
    console.warn('[NOAA] fetchAll failed, using cache:', err);
    const loaded = loadCache();
    if (!loaded) {
      // Absolute fallback: use safe defaults
      state.noaa = {
        kp:  2,
        sfi: 100,
        kpForecast: [],
        alerts: [],
        fetchedAt: null,
        stale: true,
      };
    } else {
      state.noaa.stale = true;
    }
    updateConditionsUI();
    showToast(t('toast.noaa.error'));
  }
}

/**
 * Get cached NOAA data from localStorage.
 * @returns {{ kp, sfi, kpForecast, alerts, fetchedAt } | null}
 */
export function getCached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Check if the current NOAA data is stale (older than 30 min).
 * @returns {boolean}
 */
export function isStale() {
  return state.noaa.stale ||
    !state.noaa.fetchedAt ||
    (Date.now() - state.noaa.fetchedAt) > 30 * 60 * 1000;
}

/**
 * Test a single API endpoint and return status + response time.
 * @param {{ id: string, url: string }} endpoint
 * @returns {Promise<{ status: 'ok'|'error', ms: number, code: number|null }>}
 */
export async function testEndpoint(endpoint) {
  const start = Date.now();
  try {
    const res = await fetch(endpoint.url, { cache: 'no-store' });
    return {
      status: res.ok ? 'ok' : 'error',
      ms:     Date.now() - start,
      code:   res.status,
    };
  } catch {
    return {
      status: 'error',
      ms:     Date.now() - start,
      code:   null,
    };
  }
}

/**
 * Get Kp value for a future time step.
 * Uses kpForecast for steps > 1.5h (step > 3 × 30min).
 *
 * @param {number} step - time step index (0 = now, 1 = +30min …)
 * @returns {number} Kp value
 */
export function getKpAtStep(step) {
  const current = state.noaa.kp ?? 2;
  if (!state.noaa.kpForecast.length || step < 4) return current;
  // Each forecast entry covers 3 hours = 6 steps
  const forecastIdx = Math.floor(step / 6);
  const fc = state.noaa.kpForecast;
  return fc[Math.min(forecastIdx, fc.length - 1)] ?? current;
}

// ── UI updates ──

/** Update the top bar conditions badges and conditions bar */
export function updateConditionsUI() {
  const { kp, sfi, stale, fetchedAt } = state.noaa;

  // Top bar badges
  const kpBadge  = document.getElementById('cond-kp');
  const sfiBadge = document.getElementById('cond-sfi');
  const ageBadge = document.getElementById('cond-age');

  if (kpBadge && kp !== null) {
    kpBadge.textContent = `Kp ${kp.toFixed(1)}`;
    kpBadge.className = 'cond-badge' + (kp >= 5 ? ' kp-high' : kp >= 4 ? ' kp-storm' : '');
  }
  if (sfiBadge && sfi !== null) {
    sfiBadge.textContent = `SFI ${Math.round(sfi)}`;
  }
  if (ageBadge) {
    ageBadge.textContent = stale ? '⚠ stale' : dataAge(fetchedAt);
  }

  // Conditions bar details
  const kpDetail  = document.getElementById('cond-kp-detail');
  const sfiDetail = document.getElementById('cond-sfi-detail');
  const ageDetail = document.getElementById('cond-age-detail');

  if (kpDetail  && kp  !== null) kpDetail.textContent  = kp.toFixed(1);
  if (sfiDetail && sfi !== null) sfiDetail.textContent = Math.round(sfi);
  if (ageDetail) ageDetail.textContent = stale ? t('conditions.stale') : dataAge(fetchedAt);
}

/** Show/hide the alerts bar */
export function updateAlertsUI() {
  const bar = document.getElementById('alerts-bar');
  if (!bar) return;
  const { alerts } = state.noaa;
  if (!alerts || alerts.length === 0) {
    bar.hidden = true;
    return;
  }
  // Only show WARNING / ALERT level items
  const serious = alerts.filter(a =>
    a.product_id?.includes('WARNING') ||
    a.product_id?.includes('ALERT') ||
    a.product_id?.includes('WATCH')
  );
  if (serious.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `⚡ ${serious[0].message?.split('\n')[0] ?? 'Space weather alert active'}`;
}

// ── Individual fetchers ──

async function fetchSFI() {
  const res  = await fetch(API_ENDPOINTS[0].url);
  if (!res.ok) throw new Error(`SFI HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('SFI empty response');
  // Most recent entry, use adjusted flux
  const latest = data[data.length - 1];
  const sfi = parseFloat(latest.flux ?? latest.observed_flux);
  if (isNaN(sfi)) throw new Error('SFI parse failed');
  return sfi;
}

async function fetchKp() {
  const res  = await fetch(API_ENDPOINTS[1].url);
  if (!res.ok) throw new Error(`Kp HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('Kp empty response');
  const latest = data[data.length - 1];
  const kp = parseFloat(latest.kp_index);
  if (isNaN(kp)) throw new Error('Kp parse failed');
  return kp;
}

async function fetchForecast() {
  const res = await fetch(API_ENDPOINTS[2].url);
  if (!res.ok) throw new Error(`Forecast HTTP ${res.status}`);
  const text = await res.text();
  return parseForecastText(text);
}

async function fetchAlerts() {
  const res  = await fetch(API_ENDPOINTS[3].url);
  if (!res.ok) throw new Error(`Alerts HTTP ${res.status}`);
  return await res.json();
}

/**
 * Parse NOAA 3-day geomagnetic forecast plain text.
 * Returns array of Kp numbers (3-hourly forecast values).
 *
 * Format example:
 *   NOAA Kp index breakdown May 01-03 2024:
 *   May 01     3 3 4 3 2 2 1 1
 *   May 02     2 2 2 3 2 2 1 1
 *   May 03     2 2 1 1 1 1 1 1
 *
 * @param {string} text
 * @returns {number[]}
 */
function parseForecastText(text) {
  const values = [];
  const lines  = text.split('\n');

  for (const line of lines) {
    // Look for lines with pattern: "Month DD  N N N N N N N N"
    const match = line.match(/^[A-Z][a-z]+\s+\d+\s+([\d\s]+)$/);
    if (match) {
      const nums = match[1].trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
      values.push(...nums);
    }
  }

  return values; // up to 24 values (3 days × 8 three-hourly periods)
}

// ── Cache ──

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      kp:          state.noaa.kp,
      sfi:         state.noaa.sfi,
      kpForecast:  state.noaa.kpForecast,
      alerts:      state.noaa.alerts,
      fetchedAt:   state.noaa.fetchedAt,
    }));
  } catch (err) {
    console.warn('[NOAA] Cache write failed:', err);
  }
}

function loadCache() {
  const cached = getCached();
  if (!cached) return false;
  state.noaa = {
    kp:          cached.kp   ?? 2,
    sfi:         cached.sfi  ?? 100,
    kpForecast:  cached.kpForecast ?? [],
    alerts:      cached.alerts ?? [],
    fetchedAt:   cached.fetchedAt ?? null,
    stale:       true,
  };
  return true;
}
