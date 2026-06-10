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
      kpForecast:      forecast?.values ?? [],
      kpForecastStart: forecast?.startMs ?? null,
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
        kpForecastStart: null,
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
  // FIX A5 (fase 2): voorheen werd floor(step/6) vanaf "nu" gebruikt, maar
  // de NOAA-forecast is gealigneerd op vaste 3-uurs UTC-synoptische slots
  // (00–03, 03–06, …). Nu: bereken het absolute UTC-tijdstip van de stap en
  // index in de forecast vanaf kpForecastStart (middernacht UTC dag 1).
  const current = state.noaa.kp ?? 2;
  const fc      = state.noaa.kpForecast ?? [];
  const startMs = state.noaa.kpForecastStart;
  if (!fc.length || startMs == null) return current;

  const stepMs  = Date.now() + step * 30 * 60 * 1000;
  const slotIdx = Math.floor((stepMs - startMs) / (3 * 60 * 60 * 1000));
  if (slotIdx < 0) return current;

  // Binnen het huidige 3-uurs slot wint de real-time meting van de forecast
  const nowSlot = Math.floor((Date.now() - startMs) / (3 * 60 * 60 * 1000));
  if (slotIdx === nowSlot) return current;

  return fc[Math.min(slotIdx, fc.length - 1)] ?? current;
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
  // Gebruik estimated_kp (real-time) indien beschikbaar, anders kp_index (afgerond)
  const kp = parseFloat(latest.estimated_kp ?? latest.kp_index);
  if (isNaN(kp)) throw new Error('Kp parse failed');
  return Math.round(kp * 10) / 10;  // 1 decimaal
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
  // FIX A5 (fase 2): het live NOAA-formaat is rijen = 3-uurs UT-slots,
  // kolommen = dagen ("00-03UT   3.67   2.00   3.67"). De oude regex
  // (^Month DD  n n n…$) matchte hier NIETS op — kpForecast was in
  // productie dus altijd leeg en de forecast werd nooit gebruikt.
  // Output: { values: number[24] chronologisch, startMs: epoch van
  // middernacht UTC van de eerste forecastdag }.
  const lines = text.split('\n');

  const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
                   Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

  // 1. Kolomheader vinden: "             Jun 10    Jun 11    Jun 12"
  let dayDates = [];
  for (const line of lines) {
    const m = line.match(/^\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s*$/);
    if (m) {
      const now = new Date();
      const mkDate = (mon, day) => {
        let year = now.getUTCFullYear();
        // Jaarovergang: forecast in januari met december-kolom (of omgekeerd)
        if (MONTHS[mon] === 11 && now.getUTCMonth() === 0) year -= 1;
        if (MONTHS[mon] === 0  && now.getUTCMonth() === 11) year += 1;
        return Date.UTC(year, MONTHS[mon], parseInt(day, 10));
      };
      dayDates = [mkDate(m[1], m[2]), mkDate(m[3], m[4]), mkDate(m[5], m[6])];
      break;
    }
  }

  // 2. Slot-rijen parsen: "00-03UT   3.67   2.00   3.67"
  const matrix = {}; // slotIdx (0–7) → [dag1, dag2, dag3]
  for (const line of lines) {
    const m = line.match(/^(\d{2})-\d{2}UT\s+(.+)$/);
    if (!m) continue;
    const slotIdx = Math.floor(parseInt(m[1], 10) / 3);
    const vals = m[2].trim().split(/\s+/)
      .map(v => parseFloat(v.replace(/[^\d.]/g, '')))
      .filter(n => !isNaN(n));
    if (vals.length >= 3) matrix[slotIdx] = vals.slice(0, 3);
  }

  // 3. Chronologisch afvlakken: dag1 slot0–7, dag2, dag3
  const values = [];
  for (let day = 0; day < 3; day++) {
    for (let slot = 0; slot < 8; slot++) {
      if (matrix[slot]?.[day] !== undefined) values.push(matrix[slot][day]);
    }
  }

  // Fallback op legacy-formaat ("May 01  3 3 4 3 2 2 1 1")
  if (values.length === 0) {
    for (const line of lines) {
      const m = line.match(/^[A-Z][a-z]+\s+\d+\s+([\d\s]+)$/);
      if (m) {
        const nums = m[1].trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
        values.push(...nums);
      }
    }
    const today = new Date();
    return { values, startMs: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) };
  }

  return { values, startMs: dayDates[0] ?? null };
}

// ── Cache ──

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      kp:          state.noaa.kp,
      sfi:         state.noaa.sfi,
      kpForecast:      state.noaa.kpForecast,
      kpForecastStart: state.noaa.kpForecastStart ?? null,
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
    kpForecast:      cached.kpForecast ?? [],
    kpForecastStart: cached.kpForecastStart ?? null,
    alerts:      cached.alerts ?? [],
    fetchedAt:   cached.fetchedAt ?? null,
    stale:       true,
  };
  return true;
}
