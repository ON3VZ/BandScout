/**
 * app.js — HF Band Scout entry point
 * Boot sequence, screen routing, NOAA refresh.
 */

import { state }                         from './state.js';
import { loadSettings, applyTheme,
         applyColorblind, SETTINGS_KEY } from './settings.js';
import { renderSettings }               from './settings.js';
import { load as loadI18n,
         detectBrowserLang,
         applyToDOM, t }                from './i18n.js';
import { fetchAll as fetchNoaa,
         updateConditionsUI,
         updateAlertsUI }               from './noaa.js';
import { init as initMap,
         renderBandSelector, renderScores, renderTerminator,
         showLoading, rebuild }         from './map.js';
import { init as initTimeline }         from './timeline.js';
import { updateListview, updateByBand,
         updateByRegion }               from './listview.js';
import { updateOpening }               from './opening.js';
import { buildCache, invalidateCache }  from './cache.js';
import { gridToLatLon }                from './utils.js';

const NOAA_REFRESH_MS = 15 * 60 * 1000;
const LOADING_ID      = 'loading-overlay';
const NAV_SELECTOR    = '.nav-tab';
const SCREEN_PREFIX   = 'screen-';
const SCREEN_ORDER    = ['map', 'by-band', 'by-region', 'opening', 'setup'];

// ─── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {

  // 1. Thema vroeg toepassen
  const settings = loadSettings();
  applyTheme(settings.theme || 'dark');
  applyColorblind(settings.colorblind ?? false);

  // 2. Taal
  const lang = settings.language || detectBrowserLang();
  await loadI18n(lang);
  applyToDOM();

  // 3. Lat/lon uit grid
  if (settings.grid) {
    try {
      const { lat, lon } = gridToLatLon(settings.grid);
      state.user.lat = lat;
      state.user.lon = lon;
    } catch (e) {
      console.warn('[app] Grid parse mislukt:', settings.grid, e);
    }
  }

  // 4. Loading overlay
  showGlobalLoading(true, t('ui.loading'));

  // 5. NOAA data
  try {
    await fetchNoaa();
    updateConditionsUI();
    updateAlertsUI();
  } catch (e) {
    console.warn('[app] NOAA fetch mislukt', e);
  }

  // 6. DXCC GeoJSON laden
  let features = [];
  try {
    showGlobalLoading(true, t('ui.loading_dxcc'));
    features = await loadDxcc();
    state.dxccFeatures = features;  // populeer state zodat map.js + drilldown er aan kunnen
  } catch (e) {
    console.error('[app] DXCC laden mislukt', e);
    forceHideOverlay();
    showFatalError(t('error.dxcc_load'));
    return;
  }

  // 7. Radio-profielen laden (niet-blokkerend)
  await loadRadioProfiles();

  // 8. Kaart initialiseren
  try { initMap(features); } catch (e) { console.error('[app] Map init', e); }

  // 8b. Koppel map events aan drilldown (ontkoppelde architectuur — geen circulaire imports)
  window.addEventListener('hfbs:country-click', async (e) => {
    const { openDrilldown } = await import('./drilldown.js');
    openDrilldown(e.detail);
  });

  // 8c. Registreer window callbacks voor timeline → map/listview communicatie
  window.__hfbs = window.__hfbs ?? {};

  // 9. Tijdlijn
  initTimeline();

  // 10. Score cache bouwen
  showGlobalLoading(true, t('ui.building_cache'));
  await buildCache(features, (pct, label) => updateLoadingProgress(pct, label));
  state.scoreCacheBuilt = true;

  // 11. Korte yield
  await new Promise(r => setTimeout(r, 80));

  // 12. Eerste render
  try { rebuild(); }            catch(e) { console.error('[app] rebuild', e); }

  // Zet window callbacks voor timeline (na import van map + listview)
  window.__hfbs.renderScores    = () => { try { renderScores(); } catch {} };
  window.__hfbs.renderTerminator = (...a) => { try { renderTerminator(...a); } catch {} };
  window.__hfbs.updateListview  = () => { try { updateListview(); } catch {} };
  try { showLoading(false); }   catch(e) { /* ignore */ }
  try { renderBandSelector(); } catch(e) { console.error('[app] bandselector', e); }
  try { updateListview(); }     catch(e) { console.error('[app] listview', e); }
  try { updateOpening(); }      catch(e) { console.error('[app] opening', e); }

  // 13. Overlay altijd verbergen
  forceHideOverlay();

  // 14. Navigatie
  initNav();

  // 15. Eerste keer zonder grid
  if (!settings.grid) {
    switchScreen('setup');
  }

  // 16. NOAA refresh elke 15 min
  setInterval(async () => {
    try {
      await fetchNoaa();
      updateConditionsUI();
      updateAlertsUI();
      await buildCache(features, null);
      state.scoreCacheBuilt = true;
      rebuild();
      updateListview();
      updateOpening();
    } catch (e) { console.warn('[app] NOAA refresh', e); }
  }, NOAA_REFRESH_MS);

  // 17. Cross-tab settings sync
  window.addEventListener('storage', async e => {
    if (e.key !== SETTINGS_KEY) return;
    const saved = loadSettings();
    applyTheme(saved.theme);
    applyColorblind(saved.colorblind);
    if (saved.grid) {
      try {
        const { lat, lon } = gridToLatLon(saved.grid);
        state.user.lat = lat;
        state.user.lon = lon;
      } catch { /* ignore */ }
    }
    invalidateCache();
    await buildCache(features, null);
    state.scoreCacheBuilt = true;
    rebuild();
    updateListview();
    updateOpening();
  });

  // 18. Settings-changed (zelfde tab)
  window.addEventListener('hfbs:settings-changed', async e => {
    const saved = e.detail ?? {};
    if (saved.grid) {
      try {
        const { lat, lon } = gridToLatLon(saved.grid);
        state.user.lat = lat;
        state.user.lon = lon;
      } catch { /* ignore */ }
    }
    await loadRadioProfiles(); // herlaad bij radio-wijziging
    invalidateCache();
    showGlobalLoading(true, t('ui.building_cache'));
    await buildCache(features, pct => updateLoadingProgress(pct, ''));
    state.scoreCacheBuilt = true;
    forceHideOverlay();
    rebuild();
    updateListview();
    updateOpening();
  });

})();

// ─── Navigatie ────────────────────────────────────────────────────────────────
let currentScreen = 'map';

function initNav() {
  // Maak switchScreen globaal beschikbaar voor settings.js
  window.hfbsSwitchScreen = switchScreen;

  document.querySelectorAll(NAV_SELECTOR).forEach(tab => {
    tab.addEventListener('click', () => {
      const screen = tab.dataset.screen;
      if (screen) switchScreen(screen);
    });
  });

  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => switchScreen(el.dataset.goto));
  });

  // Settings-knop rechtsboven
  document.getElementById('btn-settings')?.addEventListener('click', () => switchScreen('setup'));

  // Escape sluit drilldown
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      import('./drilldown.js').then(m => { if (m.closeDrilldown) m.closeDrilldown(); });
    }
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowRight') {
      const i = SCREEN_ORDER.indexOf(currentScreen);
      switchScreen(SCREEN_ORDER[(i + 1) % SCREEN_ORDER.length]);
    } else if (e.key === 'ArrowLeft') {
      const i = SCREEN_ORDER.indexOf(currentScreen);
      switchScreen(SCREEN_ORDER[(i - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length]);
    }
  });

  switchScreen('map');
}

export function switchScreen(name) {
  window.hfbsSwitchScreen = switchScreen;

  document.querySelectorAll('[id^="' + SCREEN_PREFIX + '"]').forEach(el => {
    el.classList.remove('is-active');
    el.removeAttribute('aria-current');
  });

  document.querySelectorAll(NAV_SELECTOR).forEach(tab => {
    const active = tab.dataset.screen === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) tab.setAttribute('aria-current', 'page');
  });

  const target = document.getElementById(SCREEN_PREFIX + name);
  if (target) {
    target.classList.add('is-active');
    target.removeAttribute('hidden');
  }

  currentScreen = name;

  // Scherm-specifieke renders
  if (name === 'setup')     renderSettings();
  if (name === 'by-band')   updateByBand();
  if (name === 'by-region') updateByRegion();
  if (name === 'opening')   updateOpening();
  if (name === 'map')       setTimeout(() => window.dispatchEvent(new Event('resize')), 50);

  document.title = name === 'map' ? 'HF Band Scout' : 'HF Band Scout – ' + name;
}

// ─── Loading overlay ──────────────────────────────────────────────────────────
function showGlobalLoading(visible, label) {
  const el = document.getElementById(LOADING_ID);
  if (!el) return;
  el.classList.toggle('is-hidden', !visible);
  el.style.display = visible ? '' : 'none';
  if (label) {
    const lbl = el.querySelector('.loading-label');
    if (lbl) lbl.textContent = label;
  }
}

function updateLoadingProgress(pct, label) {
  const el = document.getElementById(LOADING_ID);
  if (!el) return;
  const bar = el.querySelector('.loading-progress-fill');
  if (bar) bar.style.width = pct + '%';
  if (label) {
    const lbl = el.querySelector('.loading-label');
    if (lbl) lbl.textContent = label;
  }
}

function forceHideOverlay() {
  const el = document.getElementById(LOADING_ID);
  if (!el) return;
  el.style.display    = 'none';
  el.style.visibility = 'hidden';
  el.style.opacity    = '0';
  el.style.pointerEvents = 'none';
  el.setAttribute('hidden', '');
  el.classList.add('is-hidden');
}

function showFatalError(msg) {
  const div = document.createElement('div');
  div.className = 'fatal-error';
  div.textContent = msg;
  document.body.appendChild(div);
}

// ─── Data loaders ─────────────────────────────────────────────────────────────
async function loadDxcc() {
  const res = await fetch('./data/dxcc.geojson');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const gj = await res.json();
  return gj.features ?? [];
}

async function loadRadioProfiles() {
  try {
    const res = await fetch('./data/radio-profiles.json');
    if (!res.ok) return;
    state.radioProfiles = await res.json();
  } catch (e) {
    console.warn('[app] Radio profiles mislukt', e);
  }
}

export { currentScreen };
