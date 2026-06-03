/**
 * settings.js
 * Renders and manages the Setup/Settings screen.
 * Reads/writes localStorage key "hfbs_settings".
 */

import { state, ALL_BANDS, BAND_ACCESS, POWER_LIMITS } from './state.js';
import { t, SUPPORTED_LANGS, load as loadLang, applyToDOM } from './i18n.js';
import { showToast } from './utils.js';
import { testEndpoint } from './noaa.js';
import { initAll as initTooltips } from './tooltip.js';

// ─── localStorage key ─────────────────────────────────────────────────────────
export const SETTINGS_KEY = 'hfbs_settings';

// ─── Defaults ────────────────────────────────────────────────────────────────
export const DEFAULTS = {
  callsign:    '',
  grid:        '',
  licenceClass:'general',
  radioModel:  'icom-7300',
  powerW:      100,
  mode:        'ssb',
  antennaGain: 0,
  theme:       'dark',
  colorblind:  false,
  language:    'en',
};

// ─── Licence classes ──────────────────────────────────────────────────────────
const LICENCE_CLASSES = [
  { id: 'novice',     label: 'Novice / Foundation' },
  { id: 'technician', label: 'Technician (US/CEPT)' },
  { id: 'general',    label: 'General / Intermediate' },
  { id: 'extra',      label: 'Extra / Advanced' },
  { id: 'full',       label: 'Full / Amateur Extra (HAREC)' },
];

// ─── Radio models ─────────────────────────────────────────────────────────────
const RADIO_MODELS = [
  { group: 'Icom',      models: [
    { id: 'icom-7300',  name: 'Icom IC-7300' },
    { id: 'icom-7610',  name: 'Icom IC-7610' },
    { id: 'icom-705',   name: 'Icom IC-705' },
    { id: 'icom-7100',  name: 'Icom IC-7100' },
  ]},
  { group: 'Yaesu',     models: [
    { id: 'yaesu-ft-991a', name: 'Yaesu FT-991A' },
    { id: 'yaesu-ft-891',  name: 'Yaesu FT-891' },
    { id: 'yaesu-ft-710',  name: 'Yaesu FT-710' },
    { id: 'yaesu-ftdx10',  name: 'Yaesu FTDX-10' },
  ]},
  { group: 'Kenwood',   models: [
    { id: 'kenwood-ts-890s',  name: 'Kenwood TS-890S' },
    { id: 'kenwood-ts-590sg', name: 'Kenwood TS-590SG' },
  ]},
  { group: 'Elecraft',  models: [
    { id: 'elecraft-k4',  name: 'Elecraft K4' },
    { id: 'elecraft-k3s', name: 'Elecraft K3S' },
    { id: 'elecraft-kx3', name: 'Elecraft KX3' },
  ]},
  { group: 'Xiegu',     models: [
    { id: 'xiegu-g90',   name: 'Xiegu G90' },
    { id: 'xiegu-x6100', name: 'Xiegu X6100' },
  ]},
  { group: 'SDR',       models: [
    { id: 'sdr-rtlsdr',  name: 'RTL-SDR (RX only)' },
  ]},
  { group: 'Other',     models: [
    { id: 'generic',     name: 'Generic / Not listed' },
  ]},
];

const MODES = ['SSB','CW','FT8','FT4','JT65','AM','MSK144'];

// ─── Load / Save ──────────────────────────────────────────────────────────────
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const merged = { ...DEFAULTS, ...saved };
    applyToState(merged);
    return merged;
  } catch (e) {
    console.warn('[settings] load failed', e);
    applyToState(DEFAULTS);
    return { ...DEFAULTS };
  }
}

export function saveSettings(data) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    applyToState(data);
    showToast(t('settings.saved'), 'success');
  } catch (e) {
    console.warn('[settings] save failed', e);
    showToast(t('settings.save_error'), 'error');
  }
}

function applyToState(data) {
  state.user.callsign    = data.callsign     ?? '';
  state.user.grid        = data.grid         ?? '';
  state.user.licenceClass= data.licenceClass ?? 'general';
  state.user.radioModel  = data.radioModel   ?? 'icom-7300';
  state.user.powerW      = Number(data.powerW ?? 100);
  state.user.mode        = data.mode         ?? 'ssb';
  state.user.antennaGain = Number(data.antennaGain ?? 0);
  state.user.theme       = data.theme        ?? 'dark';
  state.user.colorblind  = Boolean(data.colorblind);
  state.user.language    = data.language     ?? 'en';
  applyTheme(data.theme ?? 'dark');
  applyColorblind(Boolean(data.colorblind));
}

// ─── Theme helpers ────────────────────────────────────────────────────────────
function resolveTheme(pref) {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

export function applyTheme(pref) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
}

export function applyColorblind(enabled) {
  document.documentElement.setAttribute('data-colorblind', enabled ? 'true' : 'false');
}

// ─── Render ───────────────────────────────────────────────────────────────────
export function renderSettings() {
  const screen = document.getElementById('screen-setup');
  if (!screen) return;
  const s = loadSettings();

  screen.innerHTML = `
  <div class="setup-container">

    <!-- Station ─────────────────────────────────────────── -->
    <section class="setup-section">
      <h2 class="setup-section-title">${t('settings.station')}</h2>

      <div class="setup-row">
        <label class="setup-label" for="inp-callsign">
          ${t('settings.callsign')}
          <span class="setup-hint">${t('settings.callsign.help')}</span>
        </label>
        <input id="inp-callsign" class="setup-input" type="text"
          placeholder="ON3VZ" maxlength="12"
          value="${esc(s.callsign)}" autocapitalize="characters" autocomplete="off" />
      </div>

      <div class="setup-row">
        <label class="setup-label" for="inp-grid"
               data-tooltip="settings.grid.help">
          ${t('settings.grid')}
          <span class="setup-hint">${t('settings.gridhelp')}</span>
        </label>
        <div class="setup-input-row">
          <input id="inp-grid" class="setup-input" type="text"
            placeholder="JO20ev" maxlength="6"
            value="${esc(s.grid)}" autocapitalize="characters" autocomplete="off"
            data-tooltip="settings.grid.help" />
          <span class="setup-validity" id="grid-validity"></span>
        </div>
      </div>

      <div class="setup-row">
        <label class="setup-label" for="sel-licence"
               data-tooltip="settings.license.help">
          ${t('settings.license')}
        </label>
        <select id="sel-licence" class="setup-select">
          ${LICENCE_CLASSES.map(lc =>
            `<option value="${lc.id}" ${s.licenceClass === lc.id ? 'selected' : ''}>${lc.label}</option>`
          ).join('')}
        </select>
      </div>
    </section>

    <!-- Radio ───────────────────────────────────────────── -->
    <section class="setup-section">
      <h2 class="setup-section-title">${t('settings.radio')}</h2>

      <div class="setup-row">
        <label class="setup-label" for="sel-radio"
               data-tooltip="settings.radio.help">
          ${t('settings.radio_model')}
        </label>
        <select id="sel-radio" class="setup-select">
          ${RADIO_MODELS.map(g =>
            `<optgroup label="${g.group}">
              ${g.models.map(r =>
                `<option value="${r.id}" ${s.radioModel === r.id ? 'selected' : ''}>${r.name}</option>`
              ).join('')}
            </optgroup>`
          ).join('')}
        </select>
      </div>

      <div class="setup-row">
        <label class="setup-label" for="sel-mode"
               data-tooltip="settings.mode.help">
          ${t('settings.mode')}
        </label>
        <select id="sel-mode" class="setup-select">
          ${MODES.map(m =>
            `<option value="${m.toLowerCase()}" ${s.mode === m.toLowerCase() ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </div>

      <div class="setup-row setup-row--column">
        <label class="setup-label" for="rng-power"
               data-tooltip="settings.power.help">
          ${t('settings.power')}
          <span class="setup-power-val" id="power-display">${fmtPower(s.powerW)}</span>
        </label>
        <input id="rng-power" class="setup-range" type="range"
          min="1" max="1500" step="1" value="${s.powerW}" />
        <div class="setup-power-marks">
          <span>1 W</span><span>100 W</span><span>500 W</span><span>1.5 kW</span>
        </div>
      </div>

      <div class="setup-row setup-row--column">
        <label class="setup-label" for="rng-gain"
               data-tooltip="settings.antenna_gain.help">
          ${t('settings.antenna_gain')}
          <span class="setup-power-val" id="gain-display">${s.antennaGain} dBd</span>
        </label>
        <input id="rng-gain" class="setup-range" type="range"
          min="-10" max="20" step="0.5" value="${s.antennaGain}" />
        <div class="setup-power-marks">
          <span>−10 dBd</span><span>0 dBd</span><span>+10 dBd</span><span>+20 dBd</span>
        </div>
      </div>
    </section>

    <!-- Appearance ──────────────────────────────────────── -->
    <section class="setup-section">
      <h2 class="setup-section-title">${t('settings.appearance')}</h2>

      <div class="setup-row">
        <label class="setup-label">${t('settings.theme')}</label>
        <div class="setup-radio-group">
          ${['dark','light','system'].map(th => `
            <label class="setup-radio-label">
              <input type="radio" name="theme" value="${th}"
                     ${s.theme === th ? 'checked' : ''} />
              ${t('settings.theme_' + th)}
            </label>`).join('')}
        </div>
      </div>

      <div class="setup-row setup-row--toggle">
        <label class="setup-label" for="tog-colorblind"
               data-tooltip="settings.colorblind.help">
          ${t('settings.colorblind')}
        </label>
        <button id="tog-colorblind" role="switch"
          class="toggle-switch ${s.colorblind ? 'is-on' : ''}"
          aria-checked="${s.colorblind}">
          <span class="toggle-thumb"></span>
        </button>
      </div>

      <div class="setup-row">
        <label class="setup-label" for="sel-lang"
               data-tooltip="settings.language.help">
          ${t('settings.language')}
        </label>
        <select id="sel-lang" class="setup-select">
          ${SUPPORTED_LANGS.map(l =>
            `<option value="${l.code}" ${s.language === l.code ? 'selected' : ''}>${l.label}</option>`
          ).join('')}
        </select>
      </div>
    </section>

    <!-- Propagation glossary ────────────────────────────── -->
    <section class="setup-section">
      <h2 class="setup-section-title">${t('help.section_title') !== 'help.section_title' ? t('help.section_title') : 'Propagation Glossary'}</h2>
      <div class="help-glossary">
        ${['muf','sfi','kp','greyline','dlayer','hops','score','qrp','es'].map(k => `
          <div class="help-glossary-item">
            <dt class="help-glossary-term">${k.toUpperCase()}</dt>
            <dd class="help-glossary-def">${t('help.' + k)}</dd>
          </div>`).join('')}
      </div>
    </section>

    <!-- API health ──────────────────────────────────────── -->
    <section class="setup-section">
      <h2 class="setup-section-title">${t('settings.apihealth')}</h2>
      <p class="setup-hint-block">${t('settings.apidesc')}</p>
      <table class="api-health-table">
        <thead>
          <tr>
            <th>${t('settings.api_source')}</th>
            <th>${t('settings.api_status')}</th>
            <th>${t('settings.api_latency')}</th>
          </tr>
        </thead>
        <tbody id="api-health-body">
          <tr><td colspan="3" class="api-health-loading">${t('settings.api_testing')}</td></tr>
        </tbody>
      </table>
      <button class="btn-secondary" id="btn-test-api">${t('settings.api_retest')}</button>
    </section>

    <!-- Known limitations ───────────────────────────────── -->
    <section class="setup-section setup-section--limits">
      <h2 class="setup-section-title">${t('settings.limits')}</h2>
      <ul class="limits-list">
        ${['muf','vhf','es','dxcc','radio','dx'].map(k =>
          `<li>${t('settings.limits.' + k)}</li>`
        ).join('')}
      </ul>
      <p class="setup-hint-block">
        <a href="https://github.com/ON3VZ/BandScout#known-limitations"
           target="_blank" rel="noopener">README ↗</a>
      </p>
    </section>

    <!-- Save button ─────────────────────────────────────── -->
    <div class="setup-actions">
      <button class="btn-primary" id="btn-save-settings">${t('settings.save')}</button>
    </div>

  </div>`;

  bindEvents(s);
  initTooltips(screen);
  runApiHealthCheck();
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents(initial) {
  // Callsign autocapitalize
  document.getElementById('inp-callsign')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Grid validation
  const gridInp   = document.getElementById('inp-grid');
  const gridValid = document.getElementById('grid-validity');
  gridInp?.addEventListener('input', () => {
    const v = gridInp.value.trim().toUpperCase();
    gridInp.value = v;
    if (!v) { gridValid.textContent = ''; return; }
    if (/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(v)) {
      gridValid.textContent = '✓';
      gridValid.className = 'setup-validity setup-validity--ok';
    } else {
      gridValid.textContent = '✗';
      gridValid.className = 'setup-validity setup-validity--err';
    }
  });

  // Power slider
  const pwrSlider  = document.getElementById('rng-power');
  const pwrDisplay = document.getElementById('power-display');
  pwrSlider?.addEventListener('input', () => {
    pwrDisplay.textContent = fmtPower(Number(pwrSlider.value));
  });

  // Gain slider
  const gainSlider  = document.getElementById('rng-gain');
  const gainDisplay = document.getElementById('gain-display');
  gainSlider?.addEventListener('input', () => {
    gainDisplay.textContent = `${gainSlider.value} dBd`;
  });

  // Colorblind toggle
  const togCB = document.getElementById('tog-colorblind');
  togCB?.addEventListener('click', () => {
    const nowOn = togCB.getAttribute('aria-checked') !== 'true';
    togCB.setAttribute('aria-checked', String(nowOn));
    togCB.classList.toggle('is-on', nowOn);
    applyColorblind(nowOn);
  });

  // Theme radios — immediate preview
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) applyTheme(r.value); });
  });

  // Language change — immediate re-render
  document.getElementById('sel-lang')?.addEventListener('change', async e => {
    const lang = e.target.value;
    await loadLang(lang);
    applyToDOM();
    renderSettings(); // re-render with new strings
  });

  // API re-test
  document.getElementById('btn-test-api')?.addEventListener('click', runApiHealthCheck);

  // Save
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const data = collectForm();
    if (!validate(data)) return;
    saveSettings(data);
    // Trigger cache rebuild if location changed
    if (data.grid !== initial.grid || data.powerW !== initial.powerW || data.mode !== initial.mode) {
      window.dispatchEvent(new CustomEvent('hfbs:settings-changed', { detail: data }));
    }
  });
}

function collectForm() {
  const themeR = document.querySelector('input[name="theme"]:checked');
  return {
    callsign:    (document.getElementById('inp-callsign')?.value ?? '').trim().toUpperCase(),
    grid:        (document.getElementById('inp-grid')?.value ?? '').trim().toUpperCase(),
    licenceClass:document.getElementById('sel-licence')?.value ?? 'general',
    radioModel:  document.getElementById('sel-radio')?.value ?? 'icom-7300',
    mode:        document.getElementById('sel-mode')?.value ?? 'ssb',
    powerW:      Number(document.getElementById('rng-power')?.value ?? 100),
    antennaGain: Number(document.getElementById('rng-gain')?.value ?? 0),
    theme:       themeR?.value ?? 'dark',
    colorblind:  document.getElementById('tog-colorblind')?.getAttribute('aria-checked') === 'true',
    language:    document.getElementById('sel-lang')?.value ?? 'en',
  };
}

function validate(data) {
  if (!data.grid) {
    showToast(t('settings.grid_required'), 'error');
    document.getElementById('inp-grid')?.focus();
    return false;
  }
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(data.grid)) {
    showToast(t('settings.grid_invalid'), 'error');
    document.getElementById('inp-grid')?.focus();
    return false;
  }
  return true;
}

// ─── API health ───────────────────────────────────────────────────────────────
const ENDPOINTS = [
  { id: 'sfi',      label: 'api.sfi',      url: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json' },
  { id: 'kp',       label: 'api.kp',       url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json' },
  { id: 'forecast', label: 'api.forecast', url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json' },
  { id: 'alerts',   label: 'api.alerts',   url: 'https://services.swpc.noaa.gov/products/alerts.json' },
];

async function runApiHealthCheck() {
  const tbody = document.getElementById('api-health-body');
  if (!tbody) return;

  tbody.innerHTML = ENDPOINTS.map(ep =>
    `<tr id="api-row-${ep.id}">
       <td>${t(ep.label)}</td>
       <td><span class="api-badge api-badge--testing">…</span></td>
       <td>—</td>
     </tr>`
  ).join('');

  for (const ep of ENDPOINTS) {
    const row = document.getElementById(`api-row-${ep.id}`);
    if (!row) continue;
    const t0 = performance.now();
    try {
      const ok = await testEndpoint(ep.url);
      const ms = Math.round(performance.now() - t0);
      row.cells[1].innerHTML = ok
        ? `<span class="api-badge api-badge--ok">✓ ${t('api.status.ok')}</span>`
        : `<span class="api-badge api-badge--err">✗ ${t('api.status.error')}</span>`;
      row.cells[2].textContent = `${ms} ms`;
    } catch {
      row.cells[1].innerHTML = `<span class="api-badge api-badge--err">✗ ${t('api.status.error')}</span>`;
      row.cells[2].textContent = '—';
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmtPower(w) {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${w} W`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
