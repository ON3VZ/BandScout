/**
 * wspr.js — WSPR-realiteitslaag (wspr.live)
 *
 * Twee functies:
 *  1. Kaart-overlay: échte WSPR-spots (laatste 2 u) van/naar stations in de
 *     grid van de gebruiker, als lijnen vanaf de QTH. Groen = jouw omgeving
 *     wordt dáár gehoord (TX in jouw grid), paars = dáár gezonden en hier
 *     ontvangen (RX in jouw grid). Dit is gemeten werkelijkheid naast het
 *     theoretische model — de ingebouwde "toets aan de praktijk".
 *  2. Empirische MUF-badge: de hoogste band met ≥ 3 echte spots op ≥ 1500 km
 *     rond de grid is een gemeten ondergrens van de MUF.
 *
 * Bron: https://db1.wspr.live (ClickHouse HTTP, CORS open, geen auth).
 * Queries zijn read-only SELECT's; grid wordt gevalideerd tegen injectie.
 * Geen DOM-koppeling met propagation.js — dit is een losse presentatielaag.
 */

import { state }   from './state.js';
import { t }       from './i18n.js';
import { getMap }  from './map.js';
import { showToast } from './utils.js';

const WSPR_URL   = 'https://db1.wspr.live/?query=';
const SPOT_HOURS = 2;
const SPOT_LIMIT = 300;
const CACHE_TTL  = 5 * 60 * 1000;   // 5 min per band
const MUF_TTL    = 10 * 60 * 1000;  // 10 min voor de badge

/** Bandnaam → wspr.live band-kolom (gehele MHz) */
const BAND_TO_WSPR = {
  '160m': 1, '80m': 3, '40m': 7, '30m': 10, '20m': 14,
  '17m': 18, '15m': 21, '12m': 24, '10m': 28, '6m': 50,
};

let overlay   = null;   // L.LayerGroup
let active    = false;
let spotCache = {};     // wsprBand → { fetchedAt, spots }
let mufCache  = null;   // { fetchedAt, mhz, n }

// ─── Init ─────────────────────────────────────────────────────────────────────

/** Eénmalig aanroepen vanuit app.js na map-init. */
export function initWspr() {
  const btn = document.getElementById('btn-wspr');
  if (btn) {
    btn.title = t('wspr.tip');
    btn.addEventListener('click', toggleOverlay);
  }
  // Band-wissel op de kaart → overlay verversen indien actief
  window.addEventListener('hfbs:band-changed', () => {
    if (active) renderOverlay();
  });
  updateWsprMuf(); // eerste badge-vulling (async, niet-blokkerend)
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

export async function toggleOverlay() {
  active = !active;
  const btn = document.getElementById('btn-wspr');
  if (btn) btn.classList.toggle('is-on', active);
  if (active) {
    await renderOverlay();
  } else {
    clearOverlay();
  }
}

async function renderOverlay() {
  const map = getMap();
  if (!map || typeof L === 'undefined') return;

  clearOverlay();
  overlay = L.layerGroup().addTo(map);

  let spots;
  try {
    spots = await fetchSpots(state.activeBand);
  } catch (e) {
    console.warn('[wspr] fetch mislukt', e);
    showToast(t('wspr.error'), 'error');
    return;
  }

  if (!spots.length) {
    showToast(t('wspr.none'));
    return;
  }

  const css = getComputedStyle(document.documentElement);
  const colHeard = (css.getPropertyValue('--score-excellent') || '#00C896').trim();
  const colRecv  = (css.getPropertyValue('--accent-es')       || '#7F77DD').trim();

  const uLat = state.user.lat ?? 51.18;
  const uLon = state.user.lon ?? 4.35;
  const g    = userGrid4();

  for (const s of spots) {
    // Het "verre" eind is het eind dat NIET in de gebruikersgrid ligt.
    const txIsLocal = String(s.tx_loc ?? '').toUpperCase().startsWith(g);
    const remLat = txIsLocal ? s.rx_lat : s.tx_lat;
    const remLon = txIsLocal ? s.rx_lon : s.tx_lon;
    if (remLat == null || remLon == null) continue;
    const color = txIsLocal ? colHeard : colRecv;

    L.polyline([[uLat, uLon], [remLat, remLon]], {
      color, weight: 1, opacity: 0.30, interactive: false,
    }).addTo(overlay);

    L.circleMarker([remLat, remLon], {
      radius: 3, color, fillColor: color, fillOpacity: 0.85, weight: 0,
    }).bindTooltip(
      `${txIsLocal ? s.tx_sign + ' → ' + s.rx_sign : s.tx_sign + ' → ' + s.rx_sign}` +
      ` · ${s.distance} km · SNR ${s.snr} dB`,
      { direction: 'top' }
    ).addTo(overlay);
  }
}

function clearOverlay() {
  if (overlay) {
    try { overlay.remove(); } catch { /* ignore */ }
    overlay = null;
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────

/** Grid van de gebruiker, gevalideerd (anti-injectie), 4 tekens. */
function userGrid4() {
  const g = String(state.user.grid ?? 'JO20').slice(0, 4).toUpperCase();
  return /^[A-R]{2}[0-9]{2}$/.test(g) ? g : 'JO20';
}

async function chQuery(sql) {
  const res = await fetch(WSPR_URL + encodeURIComponent(sql + ' FORMAT JSON'));
  if (!res.ok) throw new Error(`wspr.live HTTP ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

async function fetchSpots(band) {
  const b = BAND_TO_WSPR[band];
  if (b == null) return []; // VHF/UHF of onbekende band: geen WSPR-laag

  const cached = spotCache[b];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.spots;

  const g = userGrid4();
  const sql =
    `SELECT tx_sign, tx_loc, tx_lat, tx_lon, rx_sign, rx_loc, rx_lat, rx_lon, distance, snr ` +
    `FROM wspr.rx WHERE time > now() - INTERVAL ${SPOT_HOURS} HOUR AND band = ${b} ` +
    `AND (tx_loc LIKE '${g}%' OR rx_loc LIKE '${g}%') ` +
    `ORDER BY time DESC LIMIT ${SPOT_LIMIT}`;

  const spots = await chQuery(sql);
  spotCache[b] = { fetchedAt: Date.now(), spots };
  return spots;
}

// ─── Empirische MUF-badge ─────────────────────────────────────────────────────

/**
 * Hoogste band met ≥ 3 echte spots op ≥ 1500 km rond de gebruikersgrid in de
 * laatste 2 uur = gemeten ondergrens van de MUF. Wordt getoond in de
 * conditions-bar naast de theoretische waarden. Aanroepen bij init en bij
 * elke NOAA-poll (15 min).
 */
export async function updateWsprMuf() {
  const el = document.getElementById('cond-wsprmuf-detail');
  if (!el) return;

  if (mufCache && Date.now() - mufCache.fetchedAt < MUF_TTL) {
    el.textContent = formatMuf(mufCache);
    return;
  }

  try {
    const g = userGrid4();
    const rows = await chQuery(
      `SELECT band, count(*) AS n FROM wspr.rx ` +
      `WHERE time > now() - INTERVAL ${SPOT_HOURS} HOUR ` +
      `AND (tx_loc LIKE '${g}%' OR rx_loc LIKE '${g}%') AND distance >= 1500 ` +
      `GROUP BY band HAVING n >= 3 ORDER BY band DESC LIMIT 1`
    );
    mufCache = rows.length
      ? { fetchedAt: Date.now(), mhz: Number(rows[0].band), n: Number(rows[0].n) }
      : { fetchedAt: Date.now(), mhz: null, n: 0 };
    el.textContent = formatMuf(mufCache);
  } catch (e) {
    console.warn('[wspr] MUF-badge mislukt', e);
    el.textContent = '—';
  }
}

function formatMuf(m) {
  return m.mhz ? `≥ ${m.mhz} MHz` : '—';
}
