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
 * Rebuild the DXCC GeoJSON layer (call after data loads or user changes band).
 */
function buildDxccLayer() {
  if (dxccLayer) {
    leafletMap.removeLayer(dxccLayer);
    dxccLayer = null;
  }

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

  // Genereer dawn + dusk terminatorpunten
  const dawn = [], dusk = [];
  for (let lat = -89.5; lat <= 89.5; lat += 0.5) {
    const cosH = -Math.tan(lat * D2R) * Math.tan(declR);
    if (Math.abs(cosH) > 1) continue;
    const H2 = Math.acos(cosH) * R2D;
    dawn.push([lat, ((subLon - H2 + 540) % 360) - 180]);
    dusk.push([lat, ((subLon + H2 + 540) % 360) - 180]);
  }

  if (dawn.length === 0) {
    const elev = SunCalc.getPosition(date, 0, 0).altitude;
    if (elev < 0) {
      terminatorCtx.fillStyle = 'rgba(0,0,22,0.42)';
      terminatorCtx.fillRect(0, 0, W, H);
    }
    return;
  }

  // Lat/lon → canvas punt, met antimeridian-check
  function toXY(lat, lon) {
    try {
      const p = leafletMap.latLngToContainerPoint([lat, lon]);
      // Verwerp punten ver buiten het canvas (antimeridian artefact)
      if (!isFinite(p.x) || !isFinite(p.y)) return null;
      if (p.x < -W * 2 || p.x > W * 3) return null; // te ver rechts of links
      return { x: p.x, y: p.y };
    } catch { return null; }
  }

  // Antisolar punt
  const antiLon = ((subLon + 180 + 540) % 360) - 180;
  const antiPt  = toXY(-decl, antiLon);
  const nightRight = antiPt ? antiPt.x > W / 2 : false;

  terminatorCtx.save();
  terminatorCtx.fillStyle = 'rgba(0,0,22,0.42)';
  terminatorCtx.beginPath();

  // Teken dawn-lijn van laag naar hoog, met antimeridian-breuk detectie
  let prevX = null;
  let started = false;
  let lastValidY = null;

  for (const [lat, lon] of dawn) {
    const p = toXY(lat, lon);
    if (!p) { prevX = null; continue; }

    // Detecteer antimeridian-sprong: grote horizontale sprong
    const isJump = prevX !== null && Math.abs(p.x - prevX) > W * 0.5;

    if (!started || isJump) {
      terminatorCtx.moveTo(p.x, p.y);
      started = true;
    } else {
      terminatorCtx.lineTo(p.x, p.y);
    }
    prevX = p.x;
    lastValidY = p.y;
  }

  // Sluit via kaartrand naar dusk
  if (started) {
    if (nightRight) {
      terminatorCtx.lineTo(W, lastValidY ?? H);
      terminatorCtx.lineTo(W, 0);
    } else {
      terminatorCtx.lineTo(0, lastValidY ?? 0);
      terminatorCtx.lineTo(0, 0);
    }
  }

  // Dusk van hoog naar laag
  prevX = null;
  for (let k = dusk.length - 1; k >= 0; k--) {
    const [lat, lon] = dusk[k];
    const p = toXY(lat, lon);
    if (!p) { prevX = null; continue; }
    const isJump = prevX !== null && Math.abs(p.x - prevX) > W * 0.5;
    if (isJump) terminatorCtx.moveTo(p.x, p.y);
    else        terminatorCtx.lineTo(p.x, p.y);
    prevX = p.x;
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

  const allBands = ['160m','80m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'];
  const accessible = getActiveBands(state.user.licenseClass);

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
