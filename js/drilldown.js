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
import { buildReasonString } from './propagation.js';
import { stepToDate } from './timeline.js';
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
  if (panel) panel.hidden = false;
}

export function closeDrilldown() {
  const panel = document.getElementById('drilldown-panel');
  if (!panel) return;
  panel.classList.remove('is-open');
  panel.setAttribute('hidden', '');
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

  const bands   = getActiveBands(state.user.licenseClass);
  const step    = state.activeTimeOffset;
  const id      = props.dxcc_id;
  const sfi     = state.noaa.sfi ?? 100;
  const kp      = state.noaa.kp  ?? 2;

  // Collect scores
  const rows = bands.map(band => {
    const cached = state.scoreCache?.[id]?.steps?.[step];
    return {
      band,
      score:    cached?.[band]    ?? 0,
      score100W: cached?.[band]100W ?? 0,
      details:  cached?.details  ?? {},
    };
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

  const radioKey = state.user.radio;
  if (!radioKey) {
    container.innerHTML = `
      <div class="radio-settings-header">
        <h3>${t('drilldown.radio.title')}</h3>
      </div>
      <p style="font-size:var(--font-size-sm);color:var(--text-muted)">${t('drilldown.radio.noradio')}</p>
    `;
    return;
  }

  const profile = state.radioProfiles?.[radioKey];
  const band    = state.activeBand;
  const bandProfile = profile?.bands?.[band];

  const kp = state.noaa.kp ?? 2;
  const condKey = getConditionKey(band, kp);
  const settings = bandProfile?.[condKey] ?? bandProfile?.['noise_low_kp_low'];

  if (!settings) {
    container.innerHTML = `
      <div class="radio-settings-header">
        <h3>${t('drilldown.radio.title')}</h3>
        <span class="radio-model-name">${profile?.name ?? radioKey}</span>
      </div>
      <p style="font-size:var(--font-size-sm);color:var(--text-muted)">No settings for ${band}</p>
    `;
    return;
  }

  container.innerHTML = `
    <div class="radio-settings-header">
      <h3>${t('drilldown.radio.title')}</h3>
      <span class="radio-model-name">${profile?.name ?? radioKey}</span>
    </div>
    <div class="radio-settings-grid">
      <div class="radio-param">
        <span class="radio-param-label">${t('drilldown.radio.preamp')}</span>
        <span class="radio-param-value">${settings.preamp ?? '—'}</span>
      </div>
      <div class="radio-param">
        <span class="radio-param-label">${t('drilldown.radio.nb')}</span>
        <span class="radio-param-value">${settings.nb ?? '—'}</span>
      </div>
      <div class="radio-param">
        <span class="radio-param-label">${t('drilldown.radio.filter')}</span>
        <span class="radio-param-value">${settings.filter ?? '—'}</span>
      </div>
      <div class="radio-param">
        <span class="radio-param-label">${t('drilldown.radio.agc')}</span>
        <span class="radio-param-value">${settings.agc ?? '—'}</span>
      </div>
      ${settings.squelch ? `
      <div class="radio-param">
        <span class="radio-param-label">${t('drilldown.radio.squelch')}</span>
        <span class="radio-param-value">${settings.squelch}</span>
      </div>` : ''}
    </div>
    ${settings.note ? `<p class="radio-note">${settings.note}</p>` : ''}
    <p class="radio-disclaimer">⚠ ${t('drilldown.radio.disclaimer')}</p>
  `;
}

function renderBandPlan(props) {
  const container = document.getElementById('drilldown-bandplan');
  if (!container) return;

  const region  = props.itu_zone ? iauRegionFromITUZone(props.itu_zone) : state.user.iauRegion;
  const band    = state.activeBand;
  const snippet = getBandPlanSnippet(region, band);

  if (!snippet) {
    container.innerHTML = `
      <div class="bandplan-header">${t('drilldown.bandplan.title')} — ${band}</div>
      <p class="bandplan-row" style="color:var(--text-muted)">${t('drilldown.bandplan.none')}</p>
    `;
    return;
  }

  const rows = Object.entries(snippet).map(([mode, freq]) => `
    <div class="bandplan-row">
      <span class="bandplan-mode">${mode.replace(/_/g, ' ').toUpperCase()}</span>
      <span class="bandplan-freq">${formatFreq(freq)}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="bandplan-header">${t('drilldown.bandplan.title')} — ${band} (Region ${region})</div>
    ${rows}
  `;
}

function renderActions(props, azDeg) {
  const container = document.getElementById('drilldown-actions');
  if (!container) return;

  container.innerHTML = `
    <button class="action-btn primary" id="dd-btn-watch">
      📡 ${t('drilldown.copyheading')}
    </button>
    <button class="action-btn" id="dd-btn-copy">
      🧭 ${t('drilldown.copyheading')}
    </button>
  `;

  document.getElementById('dd-btn-copy')?.addEventListener('click', () => {
    const text = `${props.name} (${props.prefix}) — ${fmtAzimuth(azDeg)}`;
    navigator.clipboard?.writeText(text).then(() => {
      showToast(t('drilldown.copied'));
    });
  });

  document.getElementById('dd-btn-watch')?.addEventListener('click', () => {
    const url = `https://www.on3vz.eu/propagation-watch/?dxcc=${encodeURIComponent(props.prefix ?? '')}`;
    window.open(url, '_blank', 'noopener');
  });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getConditionKey(band, kp) {
  if (kp >= 4) return 'kp_high';
  // Rough summer noise estimate for low bands
  const month = new Date().getUTCMonth() + 1;
  const summerNoise = ['80m','40m','160m'].includes(band) && month >= 5 && month <= 9;
  return summerNoise ? 'noise_high_kp_low' : 'noise_low_kp_low';
}

function iauRegionFromITUZone(ituZone) {
  // Rough mapping: zones 1-6 EU/AF, 7-15 AS/OC, 16-27 Americas
  if (ituZone >= 16 && ituZone <= 27) return 2; // Americas
  if (ituZone >= 7  && ituZone <= 15) return 3; // Asia/Pacific (approx)
  return 1;
}

function formatFreq(freq) {
  if (Array.isArray(freq)) {
    return `${freq[0]}–${freq[1]} kHz`;
  }
  return `${freq} kHz`;
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
