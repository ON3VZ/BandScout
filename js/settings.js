/**
 * settings.js — Setup/Settings scherm
 */

import { state, ALL_BANDS, BAND_ACCESS, POWER_LIMITS } from './state.js';
import { t, SUPPORTED_LANGS, load as loadLang, applyToDOM } from './i18n.js';
import { showToast } from './utils.js';
import { testEndpoint } from './noaa.js';
import { initAll as initTooltips } from './tooltip.js';
import { switchScreen } from './app.js';

export const SETTINGS_KEY = 'hfbs_settings';

export const DEFAULTS = {
  callsign: '', grid: '', licenceClass: 'general',
  radioModel: 'icom-7300', powerW: 100, mode: 'ssb',
  antennaGain: 0, theme: 'dark', colorblind: false, language: 'en',
};

const LICENCE_CLASSES = [
  { id: 'novice',     label: 'Novice / Foundation' },
  { id: 'technician', label: 'Technician (US/CEPT)' },
  { id: 'general',    label: 'General / Intermediate' },
  { id: 'extra',      label: 'Extra / Advanced' },
  { id: 'full',       label: 'Full / HAREC' },
];

const RADIO_MODELS = [
  { group: 'Icom',     models: [
    { id: 'icom-7300',  name: 'Icom IC-7300' },
    { id: 'icom-7610',  name: 'Icom IC-7610' },
    { id: 'icom-705',   name: 'Icom IC-705' },
  ]},
  { group: 'Yaesu',    models: [
    { id: 'yaesu-ft-991a', name: 'Yaesu FT-991A' },
    { id: 'yaesu-ft-891',  name: 'Yaesu FT-891' },
    { id: 'yaesu-ft-710',  name: 'Yaesu FT-710' },
  ]},
  { group: 'Kenwood',  models: [
    { id: 'kenwood-ts-890s',  name: 'Kenwood TS-890S' },
    { id: 'kenwood-ts-590sg', name: 'Kenwood TS-590SG' },
  ]},
  { group: 'Elecraft', models: [
    { id: 'elecraft-k4',  name: 'Elecraft K4' },
    { id: 'elecraft-k3s', name: 'Elecraft K3S' },
    { id: 'elecraft-kx3', name: 'Elecraft KX3' },
  ]},
  { group: 'Xiegu',    models: [
    { id: 'xiegu-g90',   name: 'Xiegu G90' },
    { id: 'xiegu-x6100', name: 'Xiegu X6100' },
  ]},
  { group: 'SDR',      models: [
    { id: 'sdr-rtlsdr', name: 'RTL-SDR (RX only)' },
  ]},
  { group: 'Other',    models: [
    { id: 'generic', name: 'Generic / Not listed' },
  ]},
];

const MODES = ['SSB','CW','FT8','FT4','JT65','AM','MSK144'];

// ── Load / Save ──────────────────────────────────────────────────────────────
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const merged = { ...DEFAULTS, ...saved };
    applyToState(merged);
    return merged;
  } catch {
    applyToState(DEFAULTS);
    return { ...DEFAULTS };
  }
}

export function saveSettings(data) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    applyToState(data);
    showToast(t('settings.saved'), 'success');
    // Terug naar kaart
    switchScreen('map');
    // Herbereken propagatie als grid veranderd
    window.dispatchEvent(new CustomEvent('hfbs:settings-changed', { detail: data }));
  } catch (e) {
    console.error('[settings] save failed', e);
    showToast(t('settings.save_error'), 'error');
  }
}

function applyToState(d) {
  state.user.callsign    = d.callsign    ?? '';
  state.user.grid        = d.grid        ?? '';
  state.user.licenceClass= d.licenceClass?? 'general';
  state.user.radioModel  = d.radioModel  ?? 'icom-7300';
  state.user.powerW      = Number(d.powerW ?? 100);
  state.user.mode        = d.mode        ?? 'ssb';
  state.user.antennaGain = Number(d.antennaGain ?? 0);
  state.user.theme       = d.theme       ?? 'dark';
  state.user.colorblind  = Boolean(d.colorblind);
  state.user.language    = d.language    ?? 'en';
  applyTheme(d.theme ?? 'dark');
  applyColorblind(Boolean(d.colorblind));
}

export function applyTheme(pref) {
  const resolved = pref === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function applyColorblind(on) {
  document.documentElement.setAttribute('data-colorblind', on ? 'true' : 'false');
}

// ── Render ───────────────────────────────────────────────────────────────────
export function renderSettings() {
  const screen = document.getElementById('screen-setup');
  if (!screen) return;
  const s = loadSettings();

  screen.innerHTML = `
<div class="settings-page">

  <!-- Titel + Sluiten -->
  <div class="settings-toprow">
    <h1 class="settings-title">${t('settings.title')}</h1>
    <button class="settings-close-btn" id="settings-close" aria-label="Sluiten">✕</button>
  </div>

  <!-- STATION -->
  <section class="settings-section">
    <h2 class="settings-section-title">${t('settings.station')}</h2>

    <div class="settings-field">
      <label class="settings-label" for="s-callsign">${t('settings.callsign')}</label>
      <input id="s-callsign" class="settings-input" type="text"
        placeholder="e.g. ON3VZ" maxlength="12"
        value="${esc(s.callsign)}" autocapitalize="characters" autocomplete="off"/>
      <span class="settings-hint">${t('settings.callsign.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-grid">${t('settings.grid')} <span class="settings-required">*</span></label>
      <div class="settings-input-row">
        <input id="s-grid" class="settings-input" type="text"
          placeholder="e.g. JO20ev" maxlength="6"
          value="${esc(s.grid)}" autocapitalize="characters" autocomplete="off"/>
        <span id="s-grid-ok" class="settings-valid-icon"></span>
      </div>
      <span class="settings-hint">${t('settings.grid.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-licence">${t('settings.license')}</label>
      <select id="s-licence" class="settings-select">
        ${LICENCE_CLASSES.map(lc =>
          `<option value="${lc.id}" ${s.licenceClass === lc.id ? 'selected' : ''}>${lc.label}</option>`
        ).join('')}
      </select>
      <span class="settings-hint">${t('settings.license.help')}</span>
    </div>
  </section>

  <!-- TRANSCEIVER -->
  <section class="settings-section">
    <h2 class="settings-section-title">${t('settings.radio')}</h2>

    <div class="settings-field">
      <label class="settings-label" for="s-radio">${t('settings.radio_model')}</label>
      <select id="s-radio" class="settings-select">
        ${RADIO_MODELS.map(g =>
          `<optgroup label="${g.group}">${g.models.map(r =>
            `<option value="${r.id}" ${s.radioModel === r.id ? 'selected' : ''}>${r.name}</option>`
          ).join('')}</optgroup>`
        ).join('')}
      </select>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-mode">${t('settings.mode')}</label>
      <select id="s-mode" class="settings-select">
        ${MODES.map(m =>
          `<option value="${m.toLowerCase()}" ${s.mode === m.toLowerCase() ? 'selected' : ''}>${m}</option>`
        ).join('')}
      </select>
      <span class="settings-hint">${t('settings.mode.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-power">
        ${t('settings.power')}
        <span class="settings-value-badge" id="s-power-val">${fmtPower(s.powerW)}</span>
      </label>
      <input id="s-power" class="settings-range" type="range" min="1" max="1500" step="1" value="${s.powerW}"/>
      <div class="settings-range-marks"><span>1 W</span><span>100 W</span><span>500 W</span><span>1.5 kW</span></div>
      <span class="settings-hint">${t('settings.power.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-gain">
        ${t('settings.antenna_gain')}
        <span class="settings-value-badge" id="s-gain-val">${s.antennaGain} dBd</span>
      </label>
      <input id="s-gain" class="settings-range" type="range" min="-10" max="20" step="0.5" value="${s.antennaGain}"/>
      <div class="settings-range-marks"><span>−10 dBd</span><span>0 dBd</span><span>+10 dBd</span><span>+20 dBd</span></div>
    </div>
  </section>

  <!-- UITERLIJK -->
  <section class="settings-section">
    <h2 class="settings-section-title">${t('settings.appearance')}</h2>

    <div class="settings-field">
      <label class="settings-label">${t('settings.theme')}</label>
      <div class="settings-radio-row">
        ${['dark','light','system'].map(th => `
          <label class="settings-radio-label">
            <input type="radio" name="s-theme" value="${th}" ${s.theme === th ? 'checked' : ''}/>
            <span>${t('settings.theme_' + th)}</span>
          </label>`).join('')}
      </div>
    </div>

    <div class="settings-field settings-field--inline">
      <label class="settings-label" for="s-colorblind">${t('settings.colorblind')}</label>
      <button id="s-colorblind" role="switch" class="toggle-switch ${s.colorblind ? 'is-on' : ''}"
        aria-checked="${s.colorblind}"><span class="toggle-thumb"></span></button>
      <span class="settings-hint">${t('settings.colorblind.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-lang">${t('settings.language')}</label>
      <select id="s-lang" class="settings-select">
        ${SUPPORTED_LANGS.map(l =>
          `<option value="${l.code}" ${s.language === l.code ? 'selected' : ''}>${l.label}</option>`
        ).join('')}
      </select>
    </div>
  </section>

  <!-- OPSLAAN -->
  <div class="settings-save-row">
    <button class="btn-primary settings-save-btn" id="s-save">${t('settings.save')}</button>
    <button class="btn-secondary settings-cancel-btn" id="s-cancel">← ${t('nav.map')}</button>
  </div>

  <!-- PROPAGATIEGLOSSARIUM -->
  <section class="settings-section settings-section--glossary">
    <h2 class="settings-section-title">${t('help.section_title')}</h2>
    ${['muf','sfi','kp','greyline','dlayer','hops','score','qrp','es'].map(k => `
      <div class="glossary-item">
        <dt class="glossary-term">${k.toUpperCase()}</dt>
        <dd class="glossary-def">${t('help.' + k)}</dd>
      </div>`).join('')}
  </section>

  <!-- API STATUS -->
  <section class="settings-section">
    <h2 class="settings-section-title">${t('settings.apihealth')}</h2>
    <table class="api-table">
      <thead><tr>
        <th>${t('settings.api_source')}</th>
        <th>${t('settings.api_status')}</th>
        <th>${t('settings.api_latency')}</th>
      </tr></thead>
      <tbody id="s-api-body">
        <tr><td colspan="3" class="api-testing">${t('settings.api_testing')}</td></tr>
      </tbody>
    </table>
    <button class="btn-secondary" id="s-api-retest" style="margin-top:.5rem">${t('settings.api_retest')}</button>
  </section>

</div>`;

  bindEvents(s);
  runApiHealth();
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents(initial) {
  // Sluiten / terug
  document.getElementById('settings-close')?.addEventListener('click', () => switchScreen('map'));
  document.getElementById('s-cancel')?.addEventListener('click',       () => switchScreen('map'));

  // Callsign: autocaps
  document.getElementById('s-callsign')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Grid: validatie
  const gridInp = document.getElementById('s-grid');
  const gridOk  = document.getElementById('s-grid-ok');
  gridInp?.addEventListener('input', () => {
    const v = gridInp.value.trim().toUpperCase();
    gridInp.value = v;
    if (!v) { gridOk.textContent = ''; return; }
    const ok = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(v);
    gridOk.textContent = ok ? '✓' : '✗';
    gridOk.className = 'settings-valid-icon ' + (ok ? 'valid-ok' : 'valid-err');
  });

  // Power slider
  const pwrSlider = document.getElementById('s-power');
  const pwrVal    = document.getElementById('s-power-val');
  pwrSlider?.addEventListener('input', () => {
    pwrVal.textContent = fmtPower(Number(pwrSlider.value));
  });

  // Gain slider
  const gainSlider = document.getElementById('s-gain');
  const gainVal    = document.getElementById('s-gain-val');
  gainSlider?.addEventListener('input', () => {
    gainVal.textContent = `${gainSlider.value} dBd`;
  });

  // Colorblind toggle
  const togCB = document.getElementById('s-colorblind');
  togCB?.addEventListener('click', () => {
    const on = togCB.getAttribute('aria-checked') !== 'true';
    togCB.setAttribute('aria-checked', String(on));
    togCB.classList.toggle('is-on', on);
    applyColorblind(on);
  });

  // Thema: directe preview
  document.querySelectorAll('input[name="s-theme"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) applyTheme(r.value); });
  });

  // Taal: directe toepassing
  document.getElementById('s-lang')?.addEventListener('change', async e => {
    await loadLang(e.target.value);
    applyToDOM();
    renderSettings();
  });

  // Save
  document.getElementById('s-save')?.addEventListener('click', () => {
    const data = collectForm();
    if (!validate(data)) return;
    saveSettings(data);
  });

  // API hertest
  document.getElementById('s-api-retest')?.addEventListener('click', runApiHealth);
}

function collectForm() {
  const theme = document.querySelector('input[name="s-theme"]:checked')?.value ?? 'dark';
  return {
    callsign:    (document.getElementById('s-callsign')?.value ?? '').trim().toUpperCase(),
    grid:        (document.getElementById('s-grid')?.value ?? '').trim().toUpperCase(),
    licenceClass:document.getElementById('s-licence')?.value ?? 'general',
    radioModel:  document.getElementById('s-radio')?.value   ?? 'icom-7300',
    mode:        document.getElementById('s-mode')?.value    ?? 'ssb',
    powerW:      Number(document.getElementById('s-power')?.value ?? 100),
    antennaGain: Number(document.getElementById('s-gain')?.value  ?? 0),
    theme,
    colorblind:  document.getElementById('s-colorblind')?.getAttribute('aria-checked') === 'true',
    language:    document.getElementById('s-lang')?.value ?? 'en',
  };
}

function validate(data) {
  if (!data.grid) {
    showToast(t('settings.grid_required'), 'error');
    document.getElementById('s-grid')?.focus();
    return false;
  }
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(data.grid)) {
    showToast(t('settings.grid_invalid'), 'error');
    document.getElementById('s-grid')?.focus();
    return false;
  }
  return true;
}

// ── API health ────────────────────────────────────────────────────────────────
const ENDPOINTS = [
  { id: 'sfi',      label: 'api.sfi',      url: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json' },
  { id: 'kp',       label: 'api.kp',       url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json' },
  { id: 'forecast', label: 'api.forecast', url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json' },
  { id: 'alerts',   label: 'api.alerts',   url: 'https://services.swpc.noaa.gov/products/alerts.json' },
];

async function runApiHealth() {
  const tbody = document.getElementById('s-api-body');
  if (!tbody) return;
  tbody.innerHTML = ENDPOINTS.map(ep =>
    `<tr id="api-row-${ep.id}"><td>${t(ep.label)}</td><td><span class="api-badge">…</span></td><td>—</td></tr>`
  ).join('');
  for (const ep of ENDPOINTS) {
    const row = document.getElementById(`api-row-${ep.id}`);
    if (!row) continue;
    const t0 = performance.now();
    try {
      const ok = await testEndpoint(ep.url);
      const ms = Math.round(performance.now() - t0);
      row.cells[1].innerHTML = ok
        ? `<span class="api-badge api-ok">✓ OK</span>`
        : `<span class="api-badge api-err">✗ Error</span>`;
      row.cells[2].textContent = `${ms} ms`;
    } catch {
      row.cells[1].innerHTML = `<span class="api-badge api-err">✗ Error</span>`;
      row.cells[2].textContent = '—';
    }
  }
}

function fmtPower(w) { return w >= 1000 ? `${(w/1000).toFixed(1)} kW` : `${w} W`; }
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
