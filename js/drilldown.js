/**
 * HF Band Scout — Drill-Down Panel
 *
 * Slide-up panel showing per-band scores, reasoning, radio settings
 * and band plan snippets for a selected DXCC entity.
 *
 * Opened by map.js on polygon click, or by listview.js on row click.
 */

import { state, scoreClass, scoreToHex, getActiveBands, BAND_FREQ_MHZ } from './state.js';
import { t } from './i18n.js';
import { haversineKm, bearingDeg, fmtKm, fmtAzimuth, antipode, showToast } from './utils.js';
import { buildReasonString, calcReliability } from './propagation.js';
import { stepToDate } from './cache.js';
import { getKpAtStep } from './noaa.js';
import { getBandPlanSnippet } from './bandplan.js';

// ─────────────────────────────────────────────
// Open / close
// ─────────────────────────────────────────────

/**
 * Open the drill-down panel for a DXCC feature.
 * @param {Object} feature - GeoJSON feature
 */
export function openDrilldown(feature) {
  state.selectedDxcc  = feature;
  state.drilldownPath = 'short';
  render(feature);
  const panel = document.getElementById('drilldown-panel');
  if (panel) {
    panel.removeAttribute('hidden');
    panel.style.display  = '';        // reset any inline style
    panel.style.visibility = '';
    panel.classList.add('is-open');
  }
}

export function closeDrilldown() {
  const panel = document.getElementById('drilldown-panel');
  if (!panel) return;
  panel.classList.remove('is-open');
  panel.setAttribute('hidden', '');
  panel.style.display = 'none';
  state.selectedDxcc = null;
}

// ─────────────────────────────────────────────
// Initialise event listeners (call once from app.js)
// ─────────────────────────────────────────────

export function init() {
  // Close button
  document.getElementById('drilldown-close')?.addEventListener('click', closeDrilldown);

  // Short/long path toggle
  document.getElementById('drilldown-path-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.path-btn');
    if (!btn) return;
    const path = btn.dataset.path;
    state.drilldownPath = path;
    document.querySelectorAll('.path-btn').forEach(b => b.classList.toggle('active', b.dataset.path === path));
    if (state.selectedDxcc) render(state.selectedDxcc);
  });

  // Swipe down to close (mobile)
  const panel = document.getElementById('drilldown-panel');
  if (panel) setupSwipeClose(panel);
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

function render(feature) {
  const props = feature?.properties;
  if (!props) return;

  // Determine RX point (short vs long path)
  let rxLat = props.lat;
  let rxLon  = props.lon;
  if (state.drilldownPath === 'long') {
    const ap = antipode(rxLat, rxLon);
    rxLat = ap.lat;
    rxLon = ap.lon;
  }

  const txLat = state.user.lat;
  const txLon = state.user.lon;
  const distKm = haversineKm(txLat, txLon, rxLat, rxLon);
  const azDeg  = bearingDeg(txLat, txLon, rxLat, rxLon);

  renderHeader(props, distKm, azDeg);
  renderScoresTable(props, rxLat, rxLon);
  renderRadioSettings();
  renderBandPlan(props);
  renderActions(props, azDeg);
}

function renderHeader(props, distKm, azDeg) {
  const titleEl  = document.getElementById('drilldown-title');
  const prefixEl = document.getElementById('drilldown-prefix');
  const metaEl   = document.getElementById('drilldown-meta');

  if (titleEl)  titleEl.textContent  = props.name ?? '—';
  if (prefixEl) prefixEl.textContent = props.prefix ?? '';

  if (metaEl) {
    metaEl.innerHTML = `
      <span class="meta-item">
        <span class="meta-label">${t('drilldown.distance')}</span>
        <span>${fmtKm(distKm)}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">${t('drilldown.azimuth')}</span>
        <span>${fmtAzimuth(azDeg)}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">Continent</span>
        <span>${props.continent ?? '—'}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">CQ</span>
        <span>${props.cq_zone ?? '—'}</span>
      </span>
    `;
  }
}

function renderScoresTable(props, rxLat, rxLon) {
  const container = document.getElementById('drilldown-scores');
  if (!container) return;

  const bands   = getActiveBands(); // UI-FIX: fallback-keten in state.js (licenceClass eerst)
  const step    = state.activeTimeOffset;
  const id      = props.dxcc_id;
  const sfi     = state.noaa.sfi ?? 100;
  const kp      = state.noaa.kp  ?? 2;

  // 100W-REF-FIX: live berekenen i.p.v. uit de cache. De cache bewaart per
  // band alleen de power-gecorrigeerde score — geen score100W en geen
  // details, waardoor de REF-kolom altijd 0% was en HOPS altijd '—'.
  // Eén entiteit × ~6 banden is verwaarloosbaar werk, en als bonus rekent
  // de lang-pad-toggle nu écht met de antipode (voorheen toonde hij stil
  // de kort-pad-cachescores).
  const time   = stepToDate(step);
  const kpStep = getKpAtStep(step);
  const rows = bands.map(band => {
    try {
      const r = calcReliability({
        band,
        txLat: state.user.lat ?? 51.18,
        txLon: state.user.lon ?? 4.35,
        rxLat, rxLon, time,
        sfi, kp: kpStep,
        txPowerW: state.user.txPowerW ?? 25,
        mode:     state.user.mode     ?? 'ssb',
      });
      return { band, score: r.score ?? 0, score100W: r.score100W ?? 0, details: r.details ?? {} };
    } catch {
      return { band, score: 0, score100W: 0, details: {} };
    }
  });

  // Best band
  const best = rows.reduce((a, b) => b.score > a.score ? b : a, rows[0]);

  const tableHTML = `
    <div id="drilldown-scores-header">
      <h3 data-i18n="drilldown.scores">${t('drilldown.scores')}</h3>
    </div>
    <table class="score-table">
      <thead>
        <tr>
          <th>${t('drilldown.band')}</th>
          <th>${t('drilldown.score')}</th>
          <th>${t('drilldown.ref100w')}</th>
          <th>${t('drilldown.hops')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => renderScoreRow(row, row.band === best?.band, sfi, kp)).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = tableHTML;

  // Reason string for best band
  if (best && best.details) {
    const reason = buildReasonString(best.band, best.score, best.details, sfi, kp);
    const tBody = container.querySelector('tbody');
    if (tBody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" class="reason-text">${reason}</td>`;
      tBody.appendChild(tr);
    }
  }
}

function renderScoreRow(row, isBest, sfi, kp) {
  const { band, score, score100W, details } = row;
  const cls  = scoreClass(score);
  const hex  = scoreToHex(score);
  const hops = details?.hops ?? '—';

  return `
    <tr class="${isBest ? 'best-band' : ''}">
      <td class="band-name">${band}</td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar">
            <div class="score-bar-fill" style="width:${score}%;background:${hex}"></div>
          </div>
          <span class="score-pct ${cls}">${score}%</span>
        </div>
      </td>
      <td class="score-pct ref">${score100W}%</td>
      <td style="color:var(--text-muted);font-size:var(--font-size-xs)">${hops}</td>
    </tr>
  `;
}

function renderRadioSettings() {
  const container = document.getElementById('drilldown-radio-settings');
  if (!container) return;

  const radioKey = state.user.radioModel ?? state.user.radio;
  if (!radioKey) {
    container.innerHTML = `
      <div class="radio-settings-header">
        <h3>${t('drilldown.radio.title')}</h3>
      </div>
      <p style="font-size:var(--font-size-sm);color:var(--text-muted)">${t('drilldown.radio.noradio')}</p>
    `;
    return;
  }

  // Alias-resolutie (bv. icom-7300-mk2 → icom-7300)
  let profile = state.radioProfiles?.[radioKey];
  let displayName = profile?.name ?? radioKey;
  if (profile?.alias) {
    displayName = profile.name ?? displayName;
    profile = state.radioProfiles?.[profile.alias];
  }

  const band        = state.activeBand;
  const bandProfile = profile?.bands?.[band];
  const kp          = state.noaa.kp ?? 2;
  const isV2        = profile?.schema === 2;

  let settings, condKey, condLabel;
  if (isV2) {
    condKey = getConditionKey2(band);
    const entry = bandProfile?.[condKey] ?? bandProfile?.['quiet'];
    if (entry) {
      const grp = entry[modeGroup()] ?? entry['ssb'] ?? {};
      settings = { ...(entry.common ?? {}), ...grp, note: entry.note };
    }
    condLabel = t('drilldown.radio.cond.' + condKey);
  } else {
    condKey  = getConditionKeyLegacy(band, kp);
    settings = bandProfile?.[condKey] ?? bandProfile?.['noise_low_kp_low'];
    condLabel = '';
  }

  if (!settings) {
    container.innerHTML = `
      <div class="radio-settings-header">
        <h3>${t('drilldown.radio.title')}</h3>
        <span class="radio-model-name">${displayName}</span>
      </div>
      <p style="font-size:var(--font-size-sm);color:var(--text-muted)">No settings for ${band}</p>
    `;
    return;
  }

  const row = (labelKey, value) => value ? `
      <div class="radio-param">
        <span class="radio-param-label">${t(labelKey)}</span>
        <span class="radio-param-value">${value}</span>
      </div>` : '';

  const modeTag = isV2
    ? `<span class="radio-cond-chip">${condLabel}</span><span class="radio-cond-chip radio-mode-chip">${String(state.user.mode ?? 'ssb').toUpperCase()}</span>`
    : '';

  container.innerHTML = `
    <div class="radio-settings-header">
      <h3>${t('drilldown.radio.title')}</h3>
      <span class="radio-model-name">${displayName}</span>
    </div>
    ${modeTag ? `<div class="radio-cond-row">${modeTag}</div>` : ''}
    <div class="radio-settings-grid">
      ${row('drilldown.radio.preamp', settings.preamp)}
      ${row('drilldown.radio.att',    settings.att)}
      ${row('drilldown.radio.rfgain', settings.rfgain)}
      ${row('drilldown.radio.nb',     settings.nb)}
      ${row('drilldown.radio.nr',     settings.nr)}
      ${row('drilldown.radio.filter', settings.filter)}
      ${row('drilldown.radio.agc',    settings.agc)}
      ${row('drilldown.radio.ipplus', settings.ipplus)}
      ${row('drilldown.radio.squelch', settings.squelch)}
    </div>
    ${settings.note ? `<p class="radio-note">${settings.note}</p>` : ''}
    <p class="radio-disclaimer">⚠ ${t('drilldown.radio.disclaimer')}</p>
  `;
}

function renderBandPlan(props) {
  const container = document.getElementById('drilldown-bandplan');
  if (!container) return;

  const region  = (props.lon !== undefined) ? iauRegionFromLon(props.lon) : (state.user.iauRegion ?? 1);
  const band    = state.activeBand;
  const rows    = getBandPlanSnippet(region, band); // returns array of {mode, freqStr, note?, highlighted?}

  if (!rows || rows.length === 0) {
    container.innerHTML = `
      <div class="bandplan-header">${t('drilldown.bandplan.title')} — ${band}</div>
      <p class="bandplan-row" style="color:var(--text-muted)">${t('drilldown.bandplan.none')}</p>`;
    return;
  }

  // Check for note
  const noteRow  = rows.find(r => r.note);
  const dataRows = rows.filter(r => !r.note);

  const html = `
    <div class="bandplan-header">${t('drilldown.bandplan.title')} — ${band} (Region ${region})</div>
    <table class="bandplan-table">
      ${dataRows.map(r => `
        <tr class="bandplan-row${r.highlighted ? ' highlighted' : ''}">
          <td class="bandplan-mode">${r.mode.toUpperCase()}</td>
          <td class="bandplan-freq">${r.freqStr}</td>
        </tr>`).join('')}
    </table>
    ${noteRow ? `<div class="bandplan-note">ℹ ${noteRow.freqStr || noteRow.note}</div>` : ''}
  `;
  container.innerHTML = html;
}

function renderActions(props, azDeg) {
  const container = document.getElementById('drilldown-actions');
  if (!container) return;

  const azText = `${props.name} (${props.prefix}) — ${fmtAzimuth(azDeg)}`;
  container.innerHTML = `
    <button class="action-btn primary" id="dd-copy-hdg">🧭 Copy heading</button>
  `;
  document.getElementById('dd-copy-hdg')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(azText)
      .then(() => showToast('Gekopieerd: ' + azText, 'success'))
      .catch(() => showToast(azText, 'info'));
  });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Conditie-engine v2 (schema 2): quiet | qrm | storm.
 * BUG-FIX: de oude versie gaf bij Kp >= 4 'kp_high' terug — een key die in
 * geen enkel profiel bestond ('noise_low_kp_high' wél), dus storm-settings
 * werden nooit getoond.
 * Meegewogen: Kp, lokaal QRM-niveau (instelling), zomerse statiek op de
 * lage banden (mei–sep).
 */
function getConditionKey2(band) {
  const kp = state.noaa.kp ?? 2;
  if (kp >= 4) return 'storm';
  const month = new Date().getUTCMonth() + 1;
  const summerStatic = ['160m','80m','40m'].includes(band) && month >= 5 && month <= 9;
  const userQrm = (state.user.qrmLevel ?? 'low') === 'high';
  return (userQrm || summerStatic) ? 'qrm' : 'quiet';
}

/** Mode → settingsgroep in het v2-profiel */
function modeGroup() {
  const m = String(state.user.mode ?? 'ssb').toLowerCase();
  if (['ft8','ft4','jt65','msk144','psk','rtty'].includes(m)) return 'digi';
  if (m === 'cw') return 'cw';
  return 'ssb';
}

/** Legacy-mapping voor profielen met het oude schema */
function getConditionKeyLegacy(band, kp) {
  const month = new Date().getUTCMonth() + 1;
  const summerNoise = ['80m','40m','160m'].includes(band) && month >= 5 && month <= 9;
  const noise = ((state.user.qrmLevel ?? 'low') === 'high' || summerNoise) ? 'noise_high' : 'noise_low';
  const kpPart = kp >= 4 ? 'kp_high' : 'kp_low';
  return `${noise}_${kpPart}`;
}

/**
 * IARU-regio uit de centroid-lengtegraad (betrouwbaar), met ITU-zone als
 * noodfallback. BUG-FIX: de oude zone-mapping ("16–27 = Amerika's") was
 * onjuist — België is ITU-zone 27 en kreeg daardoor Region 2.
 */
function iauRegionFromLon(lon) {
  if (lon >= -170 && lon <= -30) return 2; // Amerika's
  if (lon >= 60   && lon <= 180) return 3; // Azië-Pacific
  return 1;                                 // Europa/Afrika/Midden-Oosten
}

function formatFreq(freq) {
  if (!freq) return '';
  if (typeof freq === 'number') return freq + ' kHz';
  // String: kan "7074" of "7060–7200" zijn
  return String(freq);
}

// ─────────────────────────────────────────────
// Swipe to close (mobile)
// ─────────────────────────────────────────────

function setupSwipeClose(panel) {
  let startY = 0;
  panel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) closeDrilldown(); // swipe down > 80px
  }, { passive: true });
}
