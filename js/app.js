/**
 * app.js
 * Entry point voor HF Band Scout.
 * Verantwoordelijk voor: boot-volgorde, scherm-routing, NOAA-refresh, settings-reload.
 */

import { state }                        from './state.js';
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
         renderBandSelector,
         showLoading, rebuild }         from './map.js';
import { init as initTimeline }         from './timeline.js';
import { updateListview }               from './listview.js';
import { updateOpening }                from './opening.js';
import { buildCache, invalidateCache }  from './cache.js';
import { gridToLatLon }                 from './utils.js';
import { initAll as initTooltips }      from './tooltip.js';

// ─── Constanten ───────────────────────────────────────────────────────────────
const NOAA_REFRESH_MS  = 15 * 60 * 1000;   // 15 minuten
const LOADING_ID       = 'loading-overlay';
const NAV_SELECTOR     = '.nav-tab';
const SCREEN_PREFIX    = 'screen-';

// Schermen in volgorde voor keyboard-navigatie
const SCREEN_ORDER = ['map', 'by-band', 'by-region', 'opening', 'setup'];

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async function boot() {

  // 1. Thema & kleurenblind meteen toepassen vóór render
  const settings = loadSettings();
  applyTheme(settings.theme ?? 'dark');
  applyColorblind(settings.colorblind ?? false);

  // 2. Taal laden
  const lang = settings.language || detectBrowserLang();
  await loadI18n(lang);
  applyToDOM();

  // 3. Lat/lon afleiden uit grid square
  if (settings.grid) {
    try {
      const { lat, lon } = gridToLatLon(settings.grid);
      state.user.lat = lat;
      state.user.lon = lon;
    } catch (e) {
      console.warn('[app] Grid parse mislukt:', settings.grid, e);
    }
  }

  // 4. Loading overlay tonen
  showGlobalLoading(true, t('ui.loading'));

  // 5. NOAA-data ophalen (state.noaa wordt intern bijgewerkt door noaa.js)
  try {
    await fetchNoaa();
    updateConditionsUI();   // leest state.noaa intern
    updateAlertsUI();       // leest state.noaa intern
  } catch (e) {
    console.warn('[app] NOAA fetch mislukt; cached waarden gebruikt', e);
  }

  // 6. DXCC GeoJSON laden
  let features = [];
  try {
    showGlobalLoading(true, t('ui.loading_dxcc'));
    features = await loadDxcc();
  } catch (e) {
    console.error('[app] DXCC data laden mislukt', e);
    showGlobalLoading(false);
    showFatalError(t('error.dxcc_load'));
    return;
  }

  // 7. Kaart initialiseren
  try {
    initMap(features);
  } catch (e) {
    console.error('[app] Kaart init mislukt', e);
  }

  // 8. Tijdlijn initialiseren
  initTimeline();

  // 9. Score cache bouwen (met voortgang)
  showGlobalLoading(true, t('ui.building_cache'));
  await buildCache(features, (pct, label) => {
    updateLoadingProgress(pct, label);
  });
  state.scoreCacheBuilt = true; // extra zekerheid

  // 10. Korte yield
  await new Promise(r => setTimeout(r, 80));

  // 11. Render (in try/catch zodat een fout de overlay niet blokkeert)
  try { rebuild(); }          catch(e) { console.error('[app] rebuild fout', e); }
  try { showLoading(false); } catch(e) { /* ignore */ }
  try { updateListview(); }   catch(e) { console.error('[app] listview fout', e); }
  try { updateOpening(); }    catch(e) { console.error('[app] opening fout', e); }
  try { renderBandSelector(); } catch(e) { console.error('[app] bandselector fout', e); }

  // 12. Overlay ALTIJD verwijderen — ongeacht of er fouten waren
  forceHideOverlay();

  // 12. Eerste keer zonder grid → meteen naar Settings
  if (!settings.grid) {
    switchScreen('setup');
    showNudge(t('setup.first_run'));
  }

  // 13. Navigatie binden
  initNav();

  // 14. Globale tooltips
  initTooltips(document.body);

  // 15. NOAA auto-refresh elke 15 min
  setInterval(async () => {
    try {
      await fetchNoaa();
      updateConditionsUI();
      updateAlertsUI();
      await buildCache(features, null);
      rebuild();
      updateListview();
      updateOpening();
    } catch (e) {
      console.warn('[app] NOAA refresh fout', e);
    }
  }, NOAA_REFRESH_MS);

  // 16. Settings-change luisteraar (cross-tab via localStorage)
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
      } catch { /* geen actie */ }
    }
    invalidateCache();
    await buildCache(features, null);
    rebuild();
    updateListview();
    updateOpening();
  });

  // 17. Settings-change luisteraar (zelfde tab, vanuit settings.js)
  window.addEventListener('hfbs:settings-changed', async e => {
    const saved = e.detail ?? {};
    if (saved.grid) {
      try {
        const { lat, lon } = gridToLatLon(saved.grid);
        state.user.lat = lat;
        state.user.lon = lon;
      } catch { /* geen actie */ }
    }
    invalidateCache();
    showGlobalLoading(true, t('ui.building_cache'));
    await buildCache(features, pct => updateLoadingProgress(pct, ''));
    showGlobalLoading(false);
    rebuild();
    updateListview();
    updateOpening();
  });

})();

// ─── Navigatie ────────────────────────────────────────────────────────────────
let currentScreen = 'map';

function initNav() {
  document.querySelectorAll(NAV_SELECTOR).forEach(tab => {
    tab.addEventListener('click', () => {
      const screen = tab.dataset.screen;
      if (screen) switchScreen(screen);
    });
  });


  // Settings-knop in topbar
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => switchScreen('setup'));
  }

  // Knoppen met data-goto="screenName"
  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => switchScreen(el.dataset.goto));
  });

  // Keyboard: ← → wisselt scherm (behalve in inputs)
  document.addEventListener('keydown', e => {
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
  window.hfbsSwitchScreen = switchScreen; // beschikbaar voor settings.js
  // Verberg alle schermen
  document.querySelectorAll(`[id^="${SCREEN_PREFIX}"]`).forEach(el => {
    el.classList.remove('is-active');
    el.removeAttribute('aria-current');
  });

  // Nav tabs bijwerken
  document.querySelectorAll(NAV_SELECTOR).forEach(tab => {
    const active = tab.dataset.screen === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) tab.setAttribute('aria-current', 'page');
  });

  // Doelscherm tonen
  const target = document.getElementById(`${SCREEN_PREFIX}${name}`);
  if (target) {
    target.classList.add('is-active');
    target.removeAttribute('hidden');
  }

  currentScreen = name;
  window.hfbsSwitchScreen = switchScreen;

  // Scherm-specifieke render
  if (name === 'setup')    renderSettings();
  if (name === 'by-band')  { import('./listview.js').then(m => m.updateByBand());   }
  if (name === 'by-region'){ import('./listview.js').then(m => m.updateByRegion()); }
  if (name === 'opening')  { import('./opening.js').then(m => m.updateOpening());   }

  // Kaart: resize triggeren na display:none → zichtbaar
  if (name === 'map') {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }

  // Paginatitel
  document.title = name === 'map'
    ? 'HF Band Scout'
    : `HF Band Scout – ${name}`;
}

// ─── Loading overlay ──────────────────────────────────────────────────────────
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

function showGlobalLoading(visible, label = '') {
  const el = document.getElementById(LOADING_ID);
  if (!el) return;
  el.classList.toggle('is-hidden', !visible);
  const lbl = el.querySelector('.loading-label');
  if (lbl && label) lbl.textContent = label;
  if (!visible) {
    const bar = el.querySelector('.loading-progress-fill');
    if (bar) bar.style.width = '0%';
  }
}

function updateLoadingProgress(pct, label) {
  const el = document.getElementById(LOADING_ID);
  if (!el) return;
  const bar = el.querySelector('.loading-progress-fill');
  if (bar) bar.style.width = `${pct}%`;
  if (label) {
    const lbl = el.querySelector('.loading-label');
    if (lbl) lbl.textContent = label;
  }
}

function showFatalError(msg) {
  const div = document.createElement('div');
  div.className = 'fatal-error';
  div.textContent = msg;
  document.body.appendChild(div);
}

function showNudge(msg) {
  const el = document.querySelector('.setup-nudge');
  if (el) { el.textContent = msg; el.classList.add('is-visible'); }
}

// ─── DXCC GeoJSON laden ───────────────────────────────────────────────────────
async function loadDxcc() {
  const res = await fetch('./data/dxcc.geojson');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const gj = await res.json();
  return gj.features ?? [];
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
export { currentScreen };
