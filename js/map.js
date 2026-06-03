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
import { openDrilldown } from './drilldown.js';

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
  const id    = feature.properties?.dxcc_id;
  const band  = state.activeBand;
  const step  = state.activeTimeOffset;
  const cached = state.scoreCache?.[id]?.steps?.[step];
  const score  = cached?.[band] ?? 0;

  const isGL = isGreylineFeature(feature);
  const fillColor  = scoreToHex(score);
  const borderColor = isGL ? getCSSVar('--accent-greyline') : '#333';
  const borderWidth = isGL ? 2 : 0.4;

  return {
    fillColor,
    fillOpacity: state.scoreCacheBuilt ? 0.72 : 0.15,
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
    openDrilldown(feature);
    highlightLayer(layer);
  });

  // Hover tooltip
  layer.on('mouseover', (e) => {
    const id    = feature.properties?.dxcc_id;
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
    const id     = layer.feature?.properties?.dxcc_id;
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
  if (typeof SunCalc === 'undefined')    return;

  const canvas = terminatorCtx.canvas;
  const w = canvas.width;
  const h = canvas.height;

  terminatorCtx.clearRect(0, 0, w, h);

  const date = new Date(Date.now() + timeStep * 30 * 60 * 1000);

  // Night side opacity gradient, 2px per longitude column
  const nightColor = 'rgba(0,0,0,0.35)';
  const cols = Math.ceil(w / 2);

  for (let col = 0; col < cols; col++) {
    const px = col * 2;
    // Map pixel x → longitude
    const latlng = leafletMap.containerPointToLatLng([px, h / 2]);
    const lon = latlng.lng;

    // Find the solar elevation at this longitude at the map's latitude centre
    for (let row = 0; row < h; row += 2) {
      const ll = leafletMap.containerPointToLatLng([px, row]);
      const elev = SunCalc.getPosition(date, ll.lat, ll.lng).altitude;
      if (elev < 0) {
        // Night
        terminatorCtx.fillStyle = nightColor;
        terminatorCtx.fillRect(px, row, 2, 2);
      }
    }
  }
}

// ─────────────────────────────────────────────
// Greyline helpers
// ─────────────────────────────────────────────

function isGreylineFeature(feature) {
  if (!feature?.properties) return false;
  const { lat, lon } = feature.properties;
  if (lat == null || lon == null) return false;
  const date = new Date(Date.now() + state.activeTimeOffset * 30 * 60 * 1000);
  return isInGreyline(date, lat, lon);
}

// ─────────────────────────────────────────────
// Band selector UI
// ─────────────────────────────────────────────

/**
 * Render the band selector tabs for the map screen.
 * Filtered by licence class.
 */
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
