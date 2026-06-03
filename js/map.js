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
    window.dispatchEvent(new CustomEvent('hfbs:country-click', { detail: feature }));
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

  // ── Snelle terminator: per breedtegraad de terminatorlongitude berekenen ──
  // In plaats van elk pixel te testen, berekenen we per lat-lijn (180 stappen)
  // de grens tussen dag en nacht via SunCalc.
  // Dit is ~200× sneller dan de pixel-per-pixel methode.

  // Subsolar punt (subsolar lat/lon = punt waar zon recht boven staat)
  const sunPos = SunCalc.getPosition(date, 0, 0); // referentie
  // Vind de subsolar latitude via declinatie
  const sunTimes0 = SunCalc.getTimes(date, 0, 0);
  // Gebruik een reeks latitudes om de terminatorpunten te vinden
  const STEPS = 180;
  const terminatorPoints = [];

  for (let i = 0; i <= STEPS; i++) {
    const lat = -90 + (180 * i / STEPS);
    // Zoek de longitude waar de zon precies opkomt (elevation = 0)
    // Binary search: vind lon waarbij elevation ≈ 0
    let lo = -180, hi = 180;
    for (let iter = 0; iter < 12; iter++) {
      const mid = (lo + hi) / 2;
      const elev = SunCalc.getPosition(date, lat, mid).altitude;
      if (elev > 0) hi = mid; else lo = mid;
    }
    const lon1 = (lo + hi) / 2;
    // Tweede terminatorpunt (dag→nacht aan andere kant)
    const lon2 = lon1 + 180 > 180 ? lon1 - 180 : lon1 + 180;
    terminatorPoints.push({ lat, lon1, lon2 });
  }

  // Teken de nacht-zone: links van de terminator is nacht
  // Aanpak: vul het hele canvas met nacht, clip dag-zone weg
  terminatorCtx.save();
  terminatorCtx.fillStyle = 'rgba(0,0,20,0.38)';

  // Bouw een pad langs de terminatorlijn
  terminatorCtx.beginPath();
  let first = true;
  for (const { lat, lon1 } of terminatorPoints) {
    try {
      const pt = leafletMap.latLngToContainerPoint([lat, lon1]);
      if (first) { terminatorCtx.moveTo(pt.x, pt.y); first = false; }
      else        terminatorCtx.lineTo(pt.x, pt.y);
    } catch { /* punt buiten kaart */ }
  }
  // Sluit het pad via de kaartrand (nacht-zijde)
  terminatorCtx.lineTo(w, h);
  terminatorCtx.lineTo(0, h);
  terminatorCtx.closePath();
  terminatorCtx.fill();
  terminatorCtx.restore();
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
