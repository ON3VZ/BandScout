/**
 * HF Band Scout — Map Module
 *
 * Initialises Leaflet, loads the DXCC GeoJSON layer, colours polygons
 * by propagation score, draws the day/night terminator, and handles
 * country-tap to open the drill-down panel.
 *
 * Requires Leaflet as a global (lib/leaflet/leaflet.js).
 * Requires SunCalc as a global (lib/suncalc.js).
 *
 * No RF calculations here — reads from state.scoreCache only.
 */

import { state, scoreToHex, scoreClass, getActiveBands } from './state.js';
import { haversineKm, isInGreyline, getCSSVar } from './utils.js';
// drilldown wordt geopend via custom event (geen directe import — voorkomt circulaire dep)

let leafletMap = null;
let dxccLayer  = null;
let terminatorCtx = null;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// ─────────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────────

/**
 * Initialise the Leaflet map.
 * Call once after DOM is ready and dxccFeatures are loaded.
 */
export function init() {
  if (leafletMap) return; // already initialised

  leafletMap = L.map('leaflet-map', {
    center: [20, 0],
    zoom:   2,
    minZoom: 1,
    maxZoom: 8,
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
  });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTR,
    noWrap: false,
  }).addTo(leafletMap);

  // Load DXCC layer
  if (state.dxccFeatures && state.dxccFeatures.length > 0) {
    buildDxccLayer();
  }

  // Terminator canvas
  initTerminatorCanvas();

  // Resize canvas when map moves / resizes
  leafletMap.on('resize move zoom', () => {
    resizeTerminatorCanvas();
    if (state.scoreCacheBuilt) {
      renderTerminator(state.activeTimeOffset);
    }
  });
}

/**
 * Ontvouw één polygoon-ring die de antimeridiaan (180°) overschrijdt.
 * Leaflet vult zo'n ring anders als een balk over de hele kaartbreedte
 * (Rusland, Fiji, Kiribati). We schuiven negatieve longitudes +360° zodat de
 * ring aaneengesloten rond +180° ligt. Guard: alleen toepassen als de
 * spanwijdte daardoor écht <= 180° wordt — poolomsluitende polygonen
 * (Antarctica) blijven zo ongemoeid. Idempotent.
 */
function unwrapRing(ring) {
  let min = Infinity, max = -Infinity;
  for (const pt of ring) { if (pt[0] < min) min = pt[0]; if (pt[0] > max) max = pt[0]; }
  if (max - min <= 180) return ring; // overschrijdt de datumgrens niet
  const shifted = ring.map(pt => (pt[0] < 0 ? [pt[0] + 360, pt[1]] : pt.slice()));
  let smin = Infinity, smax = -Infinity;
  for (const pt of shifted) { if (pt[0] < smin) smin = pt[0]; if (pt[0] > smax) smax = pt[0]; }
  return (smax - smin <= 180) ? shifted : ring; // afwijzen als het niet echt ontvouwt
}

/**
 * Pas unwrapRing toe op alle ringen van een feature (Polygon of MultiPolygon).
 * Geometrie is alleen voor weergave (scoring gebruikt properties.lat/lon),
 * dus dit beïnvloedt geen berekeningen.
 */
function normalizeFeatureGeometry(feature) {
  const g = feature.geometry;
  if (!g) return feature;
  if (g.type === 'Polygon') {
    g.coordinates = g.coordinates.map(unwrapRing);
  } else if (g.type === 'MultiPolygon') {
    g.coordinates = g.coordinates.map(poly => poly.map(unwrapRing));
  }
  return feature;
}

function buildDxccLayer() {
  if (dxccLayer) {
    leafletMap.removeLayer(dxccLayer);
    dxccLayer = null;
  }

  // Ontvouw antimeridiaan-overschrijdende polygonen (Rusland, Fiji, Kiribati)
  // zodat Leaflet ze niet als horizontale balk over de hele kaart vult.
  for (const f of state.dxccFeatures) normalizeFeatureGeometry(f);

  dxccLayer = L.geoJSON(
    { type: 'FeatureCollection', features: state.dxccFeatures },
    {
      style:        featureStyle,
      onEachFeature: onEachFeature,
    }
  ).addTo(leafletMap);
}

/**
 * Style function — reads from score cache for the active band/time.
 * Falls back to neutral grey if cache not ready.
 */
function featureStyle(feature) {
  const id    = String(feature.properties?.dxcc_id ?? feature.properties?.prefix ?? '');
  const band  = state.activeBand;
  const step  = state.activeTimeOffset;
  const cached = state.scoreCache?.[id]?.steps?.[step];
  const score  = cached?.[band] ?? 0;

  const isGL = isGreylineFeature(feature);
  const fillColor  = scoreToHex(score);

  // Greyline: toon via lichtere fill + dunne amber rand
  // Maar NIET op polygonen die de antimeridian overschrijden (Rusland, Kiribati)
  // om de horizontale balk te vermijden.
  const bounds = feature.bbox ?? null;
  const crossesAM = bounds ? (bounds[2] - bounds[0] > 180) : false;
  const showGLborder = isGL && !crossesAM;

  const borderColor = showGLborder ? getCSSVar('--accent-greyline') : '#333';
  const borderWidth = showGLborder ? 2 : 0.4;

  return {
    fillColor,
    fillOpacity: 0.72,
    color:       borderColor,
    weight:      borderWidth,
    opacity:     1,
  };
}

function onEachFeature(feature, layer) {
  // Click → open drill-down
  layer.on('click', () => {
    if (!feature.properties) return;
    state.selectedDxcc = feature;
    state.drilldownPath = 'short';
    window.dispatchEvent(new CustomEvent('hfbs:country-click', { detail: feature }));
    highlightLayer(layer);
  });

  // Hover tooltip
  layer.on('mouseover', (e) => {
    const id    = String(feature.properties?.dxcc_id ?? feature.properties?.prefix ?? '');
    const band  = state.activeBand;
    const step  = state.activeTimeOffset;
    const cached = state.scoreCache?.[id]?.steps?.[step];
    const score  = cached?.[band] ?? '?';
    const name   = feature.properties?.name ?? '';
    const prefix = feature.properties?.prefix ?? '';

    layer.bindTooltip(
      `<div class="prop-tooltip">${name} (${prefix}) — ${band}: ${score}%</div>`,
      { sticky: true, opacity: 1, className: '' }
    ).openTooltip(e.latlng);
  });

  layer.on('mouseout', () => {
    layer.unbindTooltip();
  });
}

let highlightedLayer = null;
function highlightLayer(layer) {
  if (highlightedLayer) {
    highlightedLayer.setStyle({ weight: 0.4, color: '#333' });
  }
  layer.setStyle({ weight: 2.5, color: '#fff' });
  layer.bringToFront();
  highlightedLayer = layer;
}

// ─────────────────────────────────────────────
// Score rendering
// ─────────────────────────────────────────────

/**
 * Re-colour all DXCC polygons from the current score cache.
 * Called after time step changes or band changes.
 * Must be < 50ms for smooth time-scrub.
 */
export function renderScores() {
  if (!dxccLayer || !state.scoreCacheBuilt) return;

  const band = state.activeBand;
  const step = state.activeTimeOffset;

  dxccLayer.eachLayer(layer => {
    const id     = String(layer.feature?.properties?.dxcc_id ?? layer.feature?.properties?.prefix ?? '');
    const cached = state.scoreCache?.[id]?.steps?.[step];
    const score  = cached?.[band] ?? 0;
    const isGL   = isGreylineFeature(layer.feature);

    layer.setStyle({
      fillColor:   scoreToHex(score),
      fillOpacity: 0.72,
      color:       isGL ? getCSSVar('--accent-greyline') : '#333',
      weight:      isGL ? 2 : 0.4,
    });
  });

  renderTerminator(step);
  updateBandDisplay();
}

/**
 * Show the loading overlay (score cache not built yet).
 */
export function showLoading(visible) {
  const el = document.getElementById('map-loading');
  if (!el) return;
  if (visible) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
    // After transition, hide from a11y tree
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }
}

// ─────────────────────────────────────────────
// Day/Night terminator
// ─────────────────────────────────────────────

function initTerminatorCanvas() {
  const canvas = document.getElementById('terminator-canvas');
  if (!canvas) return;
  terminatorCtx = canvas.getContext('2d');
  resizeTerminatorCanvas();
}

function resizeTerminatorCanvas() {
  const canvas = document.getElementById('terminator-canvas');
  if (!canvas || !leafletMap) return;
  const container = leafletMap.getContainer();
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
}

/**
 * Draw the day/night terminator as a shaded overlay.
 * Uses SunCalc to compute solar declination / subsolar point.
 *
 * @param {number} timeStep - 0-47 (30-min increments from now)
 */
export function renderTerminator(timeStep) {
  if (!terminatorCtx || !leafletMap) return;
  if (typeof SunCalc === 'undefined') return;

  const canvas = terminatorCtx.canvas;
  const W = canvas.width, H = canvas.height;
  terminatorCtx.clearRect(0, 0, W, H);

  const date = new Date(Date.now() + timeStep * 30 * 60 * 1000);
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // Subsolar longitude
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const subLon = -(utcH - 12) * 15;

  // Declinatie
  let decl = 0, bestA = -Infinity;
  for (let lat = -90; lat <= 90; lat++) {
    const a = SunCalc.getPosition(date, lat, subLon).altitude;
    if (a > bestA) { bestA = a; decl = lat; }
  }
  for (let dlat = -1; dlat <= 1; dlat += 0.1) {
    const a = SunCalc.getPosition(date, decl + dlat, subLon).altitude;
    if (a > bestA) { bestA = a; decl += dlat; }
  }

  const declR = decl * D2R;

  // ── Terminator als ÉÉN doorlopende curve, geparametriseerd per LENGTEGRAAD ──
  // Voor elke lon bestaat er precies één terminator-breedtegraad:
  //   lat = atan( -cos(H) / tan(decl) ),  met H = lon - subsolaire lon
  // Dit geeft een gladde, ononderbroken boog — geen antimeridiaan-sprongen,
  // geen poolgaten, geen losse subpaden. Daarmee verdwijnen de rechte grijze
  // lijnen die de oude per-breedtegraad-aanpak in de fill achterliet.
  const tanDecl = Math.tan(declR);

  function toXY(lat, lon) {
    try {
      const p = leafletMap.latLngToContainerPoint([lat, lon]);
      if (!isFinite(p.x) || !isFinite(p.y)) return null;
      return { x: p.x, y: p.y };
    } catch { return null; }
  }

  // Welke pool ligt in het donker?
  //   decl >= 0 (zon boven NH) → zuidpool donker → nacht aan ONDERkant canvas
  //   decl <  0 (zon boven ZH) → noordpool donker → nacht aan BOVENkant canvas
  const southDark = decl >= 0;

  terminatorCtx.save();
  terminatorCtx.fillStyle = 'rgba(0,0,22,0.42)';
  terminatorCtx.beginPath();

  // Bemonster ruim buiten ±180° zodat het pad de volledige canvasbreedte
  // dekt, ook als de kaart horizontaal verschoven is (worldCopyJump).
  let started = false;
  for (let lon = -360; lon <= 360; lon += 2) {
    const Hdeg = lon - subLon;
    const tlat = Math.atan(-Math.cos(Hdeg * D2R) / tanDecl) * R2D;
    const p = toXY(tlat, lon);
    if (!p) continue;
    if (!started) { terminatorCtx.moveTo(p.x, p.y); started = true; }
    else          { terminatorCtx.lineTo(p.x, p.y); }
  }

  if (!started) {
    // Volledige pooldag/poolnacht binnen beeld: vul of laat leeg
    const elev = SunCalc.getPosition(date, 0, subLon).altitude;
    if (elev < 0) {
      terminatorCtx.fillStyle = 'rgba(0,0,22,0.42)';
      terminatorCtx.fillRect(0, 0, W, H);
    }
    terminatorCtx.restore();
    return;
  }

  // Sluit het pad langs de donkere poolrand. Deze sluitlijnen liggen op de
  // canvasrand (onder- of bovenkant) en zijn dus onzichtbaar.
  if (southDark) {
    terminatorCtx.lineTo(W, H);
    terminatorCtx.lineTo(0, H);
  } else {
    terminatorCtx.lineTo(W, 0);
    terminatorCtx.lineTo(0, 0);
  }

  terminatorCtx.closePath();
  terminatorCtx.fill();
  terminatorCtx.restore();
}

// ─── Greyline helper ──────────────────────────────────────────────────────────
function isGreylineFeature(feature) {
  if (!feature?.properties) return false;
  const { lat, lon } = feature.properties;
  if (lat == null || lon == null) return false;
  const date = new Date(Date.now() + state.activeTimeOffset * 30 * 60 * 1000);
  return isInGreyline(date, lat, lon);
}





export function renderBandSelector() {
  const container = document.getElementById('band-selector');
  if (!container) return;

  const allBands = ['160m','80m','40m','30m','20m','17m','15m','12m','10m','6m'];
  const accessible = getActiveBands(); // UI-FIX: fallback-keten in state.js (licenceClass eerst)

  container.innerHTML = '';

  for (const band of allBands) {
    const btn = document.createElement('button');
    btn.className  = 'band-tab' + (band === state.activeBand ? ' active' : '');
    btn.textContent = band;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', band === state.activeBand ? 'true' : 'false');

    if (!accessible.includes(band)) {
      btn.disabled = true;
      btn.title = `Not available with your licence class`;
    } else {
      btn.addEventListener('click', () => {
        state.activeBand = band;
        renderBandSelector();
        renderScores();
        updateBandDisplay();
        window.dispatchEvent(new CustomEvent('hfbs:band-changed', { detail: band }));
      });
    }

    container.appendChild(btn);
  }
}

function updateBandDisplay() {
  const el = document.getElementById('cond-band-detail');
  if (el) el.textContent = state.activeBand;
}

// ─────────────────────────────────────────────
// Initial data load trigger
// ─────────────────────────────────────────────
/**
 * Called after score cache is built — re-styles all layers.
 */
export function onCacheReady() {
  if (!dxccLayer) {
    buildDxccLayer();
  }
  renderScores();
  showLoading(false);
}

/**
 * Invalidate and rebuild DXCC layer (e.g. after settings change).
 */
export function rebuild() {
  buildDxccLayer();
  renderBandSelector();
  if (state.scoreCacheBuilt) renderScores();
}

/**
 * Get the current Leaflet map instance (for external modules).
 * @returns {L.Map|null}
 */
export function getMap() {
  return leafletMap;
}
