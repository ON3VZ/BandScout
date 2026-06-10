/**
 * settings.js - Setup/Settings scherm
 * GEEN import van app.js (vermijdt circulaire import)
 * switchScreen via window.hfbsSwitchScreen (gezet door app.js)
 */

import { state } from './state.js';
import { t, SUPPORTED_LANGS, load as loadLang, applyToDOM } from './i18n.js';
import { showToast } from './utils.js';
import { testEndpoint } from './noaa.js';

export const SETTINGS_KEY = 'hfbs_settings';

export const DEFAULTS = {
  callsign: '', grid: '', licenceClass: 'novice_be',
  radioModel: 'icom-7300', txPowerW: 25, mode: 'ssb',
  antennaGain: 0, theme: 'dark', colorblind: false, language: 'en',
  qrmLevel: 'low',   // 'low' | 'high' — lokaal stoorniveau, drijft de zender-aanbevelingen
};

// Licentie klassen incl. Belgische Klasse C
const LICENCE_CLASSES = [
  { id: 'novice_be', label: 'Klasse C (25W, België)', maxW: 25,
    bands: ['80m','40m','30m','20m','15m','10m','2m','70cm'],
    note: 'Belgisch BIPT Klasse C: 80/40/30/20/15/10m HF · Max 25 W EIRP' },
  { id: 'novice',    label: 'Novice / Foundation (overige landen)', maxW: 50,
    bands: ['80m','40m','30m','20m','15m','10m','2m','70cm'],
    note: '' },
  { id: 'technician',label: 'Technician (US/CEPT)', maxW: 100,
    bands: ['80m','40m','30m','20m','15m','10m','6m','2m','70cm'],
    note: '' },
  { id: 'general',   label: 'General / Intermediate (B-licentie)', maxW: 100,
    bands: ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'],
    note: '' },
  { id: 'extra',     label: 'Extra / Advanced', maxW: 400,
    bands: ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','4m','2m','70cm','23cm'],
    note: '' },
  { id: 'full',      label: 'Full / HAREC (A-licentie)', maxW: 1500,
    bands: ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','4m','2m','70cm','23cm'],
    note: '' },
];

export function getLicenceClass(id) {
  return LICENCE_CLASSES.find(l => l.id === id) ?? LICENCE_CLASSES[0];
}

const RADIO_MODELS = [
  { group: 'Icom', models: [
    { id: 'icom-7300-mk2', name: 'Icom IC-7300 MkII' }, { id: 'icom-7300', name: 'Icom IC-7300' }, { id: 'icom-7610', name: 'Icom IC-7610' },
    { id: 'icom-705',  name: 'Icom IC-705'  }, { id: 'icom-7100', name: 'Icom IC-7100'  },
  ]},
  { group: 'Yaesu', models: [
    { id: 'yaesu-ft-991a', name: 'Yaesu FT-991A' },
    { id: 'yaesu-ft-891',  name: 'Yaesu FT-891'  },
    { id: 'yaesu-ft-710',  name: 'Yaesu FT-710'  },
  ]},
  { group: 'Kenwood', models: [
    { id: 'kenwood-ts-890s',  name: 'Kenwood TS-890S'  },
    { id: 'kenwood-ts-590sg', name: 'Kenwood TS-590SG' },
  ]},
  { group: 'Elecraft', models: [
    { id: 'elecraft-k4',  name: 'Elecraft K4'  },
    { id: 'elecraft-k3s', name: 'Elecraft K3S' },
    { id: 'elecraft-kx3', name: 'Elecraft KX3' },
  ]},
  { group: 'Xiegu', models: [
    { id: 'xiegu-g90',   name: 'Xiegu G90'   },
    { id: 'xiegu-x6100', name: 'Xiegu X6100' },
  ]},
  { group: 'SDR / Other', models: [
    { id: 'sdr-rtlsdr', name: 'RTL-SDR (RX only)' },
    { id: 'generic',    name: 'Generic / Not listed' },
  ]},
];

const MODES = ['SSB','CW','FT8','FT4','JT65','AM','MSK144'];

// ─── Load / Save ─────────────────────────────────────────────────────────────
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
    goBack();
    window.dispatchEvent(new CustomEvent('hfbs:settings-changed', { detail: data }));
  } catch (e) {
    console.error('[settings] save failed', e);
    showToast(t('settings.save_error'), 'error');
  }
}

/**
 * Persisteer één of meer velden direct naar localStorage (merge),
 * zonder formuliervalidatie. Voor globale voorkeuren (taal, thema)
 * die niet achter de Save-knop horen te wachten.
 */
function persistPartial(patch) {
  try {
    const raw    = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : { ...DEFAULTS };
    Object.assign(stored, patch);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  } catch (e) {
    console.warn('[settings] persistPartial failed', e);
  }
}

function goBack() {
  // UI-FIX (Android): als het on-screen toetsenbord open is bij Save, kan de
  // visual viewport verschoven blijven waardoor topbar + nav buiten beeld
  // staan ("map zonder menuknoppen"). Eerst blur (toetsenbord dicht), dan
  // alle scrollposities hard naar 0.
  try { document.activeElement?.blur?.(); } catch { /* ignore */ }
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  if (typeof window.hfbsSwitchScreen === 'function') {
    window.hfbsSwitchScreen('map');
  }
}

export function applyToState(d) {
  state.user.callsign     = d.callsign     ?? '';
  state.user.grid         = d.grid         ?? '';
  state.user.licenceClass = d.licenceClass ?? 'novice_be';
  // UI-FIX: map.js/drilldown.js lazen state.user.licenseClass (US-spelling)
  // die nooit werd bijgewerkt — bandfiltering stond daardoor ALTIJD op 'A'.
  // Beide spellingen synchroon houden tot alle lezers zijn gemigreerd.
  state.user.licenseClass = d.licenceClass ?? 'novice_be';
  state.user.radioModel   = d.radioModel   ?? 'icom-7300';
  state.user.txPowerW       = Number(d.txPowerW ?? 25);
  state.user.mode         = d.mode         ?? 'ssb';
  state.user.qrmLevel     = d.qrmLevel     ?? 'low';
  state.user.antennaGain  = Number(d.antennaGain ?? 0);
  state.user.theme        = d.theme        ?? 'dark';
  state.user.colorblind   = Boolean(d.colorblind);
  state.user.language     = d.language     ?? 'en';
  applyTheme(d.theme ?? 'dark');
  applyColorblind(Boolean(d.colorblind));
}

export function applyTheme(pref) {
  const r = pref === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : (pref || 'dark');
  document.documentElement.setAttribute('data-theme', r);
}

export function applyColorblind(on) {
  document.documentElement.setAttribute('data-colorblind', on ? 'true' : 'false');
}

// ─── Render ───────────────────────────────────────────────────────────────────
export function renderSettings(override) {
  const screen = document.getElementById('screen-setup');
  if (!screen) return;
  // PERSISTENTIE-FIX: override = actuele formulierwaarden, zodat een
  // her-render (bv. na taalwissel) geen onbewaarde wijzigingen wist.
  const s  = override ?? loadSettings();
  const lc = getLicenceClass(s.licenceClass);

  screen.innerHTML = buildHTML(s, lc);
  bindEvents(s, lc);
  runApiHealth();
}

function buildHTML(s, lc) {
  return `<div class="settings-page">

  <div class="settings-toprow">
    <h1 class="settings-title">${t('settings.title')}</h1>
    <button class="settings-close-btn" id="s-close">✕</button>
  </div>

  <section class="settings-section">
    <h2 class="settings-section-title">${t('settings.station')}</h2>

    <div class="settings-field">
      <label class="settings-label" for="s-callsign">${t('settings.callsign')}</label>
      <input id="s-callsign" class="settings-input" type="text"
        placeholder="e.g. G3XYZ" maxlength="12" value="${esc(s.callsign)}"
        autocapitalize="characters" autocomplete="off"/>
      <span class="settings-hint">${t('settings.callsign.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-grid">
        ${t('settings.grid')} <span class="settings-required">*</span>
      </label>
      <div class="settings-input-row">
        <input id="s-grid" class="settings-input" type="text"
          placeholder="e.g. JO20ev" maxlength="6" value="${esc(s.grid)}"
          autocapitalize="characters" autocomplete="off"/>
        <span id="s-grid-ok" class="settings-valid-icon"></span>
      </div>
      <span class="settings-hint">${t('settings.grid.help')}</span>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-licence">${t('settings.license')}</label>
      <select id="s-licence" class="settings-select">
        ${LICENCE_CLASSES.map(lc2 =>
          `<option value="${lc2.id}" ${s.licenceClass === lc2.id ? 'selected' : ''}>${lc2.label}</option>`
        ).join('')}
      </select>
      ${lc.note ? `<div id="s-licence-note" class="settings-hint settings-licence-note">ℹ ${lc.note}</div>` : `<div id="s-licence-note" class="settings-hint settings-licence-note"></div>`}
    </div>
  </section>

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
      <label class="settings-label" for="s-qrm">${t('settings.qrm')}</label>
      <select id="s-qrm" class="settings-select">
        <option value="low" ${s.qrmLevel !== 'high' ? 'selected' : ''}>${t('settings.qrm_low')}</option>
        <option value="high" ${s.qrmLevel === 'high' ? 'selected' : ''}>${t('settings.qrm_high')}</option>
      </select>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-power">
        ${t('settings.power')}
        <span class="settings-value-badge" id="s-power-val">${fmtPower(Math.min(s.txPowerW, lc.maxW))}</span>
      </label>
      <input id="s-power" class="settings-range" type="range"
        min="1" max="${lc.maxW}" step="1" value="${Math.min(s.txPowerW, lc.maxW)}"/>
      <div class="settings-range-marks" id="s-power-marks">${buildPowerMarks(lc.maxW)}</div>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="s-gain">
        ${t('settings.antenna_gain')}
        <span class="settings-value-badge" id="s-gain-val">${s.antennaGain} dBd</span>
      </label>
      <input id="s-gain" class="settings-range" type="range"
        min="-10" max="20" step="0.5" value="${s.antennaGain}"/>
      <div class="settings-range-marks">
        <span>−10 dBd</span><span>0 dBd</span><span>+10 dBd</span><span>+20 dBd</span>
      </div>
    </div>
  </section>

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
      <label class="settings-label">${t('settings.colorblind')}</label>
      <button id="s-colorblind" role="switch"
        class="toggle-switch ${s.colorblind ? 'is-on' : ''}"
        aria-checked="${s.colorblind}">
        <span class="toggle-thumb"></span>
      </button>
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

  <div class="settings-save-row">
    <button class="settings-save-btn" id="s-save">${t('settings.save')}</button>
    <button class="settings-cancel-btn" id="s-cancel">← ${t('nav.map')}</button>
  </div>

  <section class="settings-section settings-section--glossary">
    <h2 class="settings-section-title">${t('help.section_title')}</h2>
    ${['muf','sfi','kp','greyline','dlayer','hops','score','qrp','es'].map(k => `
      <div class="glossary-item">
        <dt class="glossary-term">${k.toUpperCase()}</dt>
        <dd class="glossary-def">${t('help.' + k)}</dd>
      </div>`).join('')}
  </section>

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
    <button class="btn-secondary" id="s-api-retest" style="margin-top:.75rem">
      ${t('settings.api_retest')}
    </button>
  </section>

</div>`;
}

function buildPowerMarks(maxW) {
  if (maxW <= 25)   return '<span>1 W</span><span>10 W</span><span>25 W</span>';
  if (maxW <= 100)  return '<span>1 W</span><span>50 W</span><span>100 W</span>';
  if (maxW <= 400)  return '<span>1 W</span><span>100 W</span><span>400 W</span>';
  return '<span>1 W</span><span>100 W</span><span>500 W</span><span>1.5 kW</span>';
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents(initial, initialLc) {
  document.getElementById('s-close')?.addEventListener('click', goBack);
  document.getElementById('s-cancel')?.addEventListener('click', goBack);

  document.getElementById('s-callsign')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });

  const gridInp = document.getElementById('s-grid');
  const gridOk  = document.getElementById('s-grid-ok');
  if (gridInp) {
    if (gridInp.value) {
      const ok = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(gridInp.value);
      gridOk.textContent = ok ? '✓' : '✗';
      gridOk.className = 'settings-valid-icon ' + (ok ? 'valid-ok' : 'valid-err');
    }
    gridInp.addEventListener('input', () => {
      const v = gridInp.value.trim().toUpperCase();
      gridInp.value = v;
      if (!v) { gridOk.textContent = ''; return; }
      const ok = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(v);
      gridOk.textContent = ok ? '✓' : '✗';
      gridOk.className = 'settings-valid-icon ' + (ok ? 'valid-ok' : 'valid-err');
    });
  }

  const licSel    = document.getElementById('s-licence');
  const pwrSlider = document.getElementById('s-power');
  const pwrVal    = document.getElementById('s-power-val');
  const pwrMarks  = document.getElementById('s-power-marks');
  const lcNote    = document.getElementById('s-licence-note');

  licSel?.addEventListener('change', () => {
    const lc = getLicenceClass(licSel.value);
    if (pwrSlider) {
      pwrSlider.max = String(lc.maxW);
      if (Number(pwrSlider.value) > lc.maxW) {
        pwrSlider.value = String(lc.maxW);
        if (pwrVal) pwrVal.textContent = fmtPower(lc.maxW);
      }
    }
    if (pwrMarks) pwrMarks.innerHTML = buildPowerMarks(lc.maxW);
    if (lcNote) lcNote.textContent = lc.note ? 'ℹ ' + lc.note : '';
  });

  pwrSlider?.addEventListener('input', () => {
    if (pwrVal) pwrVal.textContent = fmtPower(Number(pwrSlider.value));
  });

  const gainSlider = document.getElementById('s-gain');
  const gainVal    = document.getElementById('s-gain-val');
  gainSlider?.addEventListener('input', () => {
    if (gainVal) gainVal.textContent = `${gainSlider.value} dBd`;
  });

  const togCB = document.getElementById('s-colorblind');
  togCB?.addEventListener('click', () => {
    const on = togCB.getAttribute('aria-checked') !== 'true';
    togCB.setAttribute('aria-checked', String(on));
    togCB.classList.toggle('is-on', on);
    applyColorblind(on);
  });

  document.querySelectorAll('input[name="s-theme"]').forEach(r => {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      applyTheme(r.value);
      persistPartial({ theme: r.value }); // PERSISTENTIE-FIX: direct bewaren
    });
  });

  document.getElementById('s-lang')?.addEventListener('change', async e => {
    // PERSISTENTIE-FIX: voorheen her-renderde dit het formulier vanuit de
    // OPGESLAGEN settings — alle onbewaarde wijzigingen (radio, grid, én de
    // taalkeuze zelf) sprongen terug. Taal was daardoor nooit te wijzigen.
    const current = collectForm();
    current.language = e.target.value;
    persistPartial({ language: current.language });
    state.user.language = current.language;
    await loadLang(current.language);
    applyToDOM();
    renderSettings(current); // her-render mét behoud van formulierwaarden
  });

  document.getElementById('s-save')?.addEventListener('click', () => {
    const data = collectForm();
    if (!validate(data)) return;
    saveSettings(data);
  });

  document.getElementById('s-api-retest')?.addEventListener('click', runApiHealth);
}

function collectForm() {
  const theme = document.querySelector('input[name="s-theme"]:checked')?.value ?? 'dark';
  const licId = document.getElementById('s-licence')?.value ?? 'novice_be';
  const lc    = getLicenceClass(licId);
  const rawPwr = Number(document.getElementById('s-power')?.value ?? 25);
  return {
    callsign:     (document.getElementById('s-callsign')?.value ?? '').trim().toUpperCase(),
    grid:         (document.getElementById('s-grid')?.value ?? '').trim().toUpperCase(),
    licenceClass: licId,
    radioModel:   document.getElementById('s-radio')?.value   ?? 'icom-7300',
    mode:         document.getElementById('s-mode')?.value    ?? 'ssb',
    txPowerW:       Math.min(rawPwr, lc.maxW),
    antennaGain:  Number(document.getElementById('s-gain')?.value ?? 0),
    qrmLevel:     document.getElementById('s-qrm')?.value ?? 'low',
    theme,
    colorblind:   document.getElementById('s-colorblind')?.getAttribute('aria-checked') === 'true',
    language:     document.getElementById('s-lang')?.value ?? 'en',
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

// ─── API health ───────────────────────────────────────────────────────────────
const ENDPOINTS = [
  { id: 'sfi',      label: 'api.sfi',      url: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json' },
  { id: 'kp',       label: 'api.kp',       url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json' },
  { id: 'forecast', label: 'api.forecast', url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json' },
  { id: 'alerts',   label: 'api.alerts',   url: 'https://services.swpc.noaa.gov/products/alerts.json' },
  { id: 'wspr',     label: 'api.wspr',     url: 'https://db1.wspr.live/?query=' + encodeURIComponent('SELECT 1 FORMAT JSON') },
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
    }
  }
}

function fmtPower(w) { return w >= 1000 ? `${(w/1000).toFixed(1)} kW` : `${w} W`; }
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


