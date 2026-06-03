/**
 * opening.js
 * "Opening Soon" screen — scans scoreCache for threshold crossings
 * within the next N time steps and renders ranked rows.
 */

import { state, ALL_BANDS, scoreClass } from './state.js';
import { t } from './i18n.js';
import { openDrilldown } from './drilldown.js';
import { formatCountdown } from './utils.js';

// An opening is detected when score crosses OPEN_THRESHOLD going upward
const OPEN_THRESHOLD  = 30;   // below this = effectively closed
const CLOSE_THRESHOLD = 20;   // hysteresis
const LOOK_AHEAD_STEPS = 12;  // 6 hours
const STEP_MINUTES     = 30;

// ─── Main render ─────────────────────────────────────────────────────────────
export function updateOpening() {
  const container = document.getElementById('screen-opening');
  if (!container) return;

  const cache = state.scoreCache;
  if (!cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  const currentStep = state.ui.timeStep;
  const openings    = findOpenings(cache, currentStep);

  if (openings.length === 0) {
    container.innerHTML = `
      <div class="opening-empty">
        <div class="opening-empty-icon">📻</div>
        <div class="opening-empty-text">${t('opening.none_found')}</div>
        <div class="opening-empty-sub">${t('opening.try_later')}</div>
      </div>`;
    return;
  }

  // Sort by steps until opening (soonest first), then by peak score
  openings.sort((a, b) => {
    if (a.stepsUntil !== b.stepsUntil) return a.stepsUntil - b.stepsUntil;
    return b.peakScore - a.peakScore;
  });

  let html = `<div class="opening-header">
    <span class="opening-count">${t('opening.found', { n: openings.length })}</span>
  </div>`;

  for (const op of openings) {
    const sc       = scoreClass(op.peakScore);
    const deltaStr = op.deltaScore > 0 ? `+${op.deltaScore}` : `${op.deltaScore}`;
    const deltaCls = op.deltaScore > 0 ? 'delta-up' : 'delta-down';
    const minUntil = op.stepsUntil * STEP_MINUTES;
    const countdown= formatCountdown(minUntil * 60); // formatCountdown takes seconds

    html += `
      <div class="opening-row" data-dxcc="${escHtml(op.dxccId)}" role="button" tabindex="0">
        <div class="opening-row-left">
          <span class="opening-prefix">${escHtml(op.prefix)}</span>
          <span class="opening-name">${escHtml(op.name)}</span>
          <span class="opening-cont">${escHtml(op.continent)}</span>
        </div>
        <div class="opening-row-right">
          <span class="band-tag opening-band">${op.band}</span>
          <span class="opening-score ${sc}">${op.peakScore}</span>
          <span class="opening-delta ${deltaCls}">${deltaStr}</span>
          <span class="opening-countdown">
            ${op.stepsUntil === 0
              ? `<span class="opening-now">${t('opening.now')}</span>`
              : `<span class="opening-timer">~${countdown}</span>`
            }
          </span>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  // Bind clicks → drilldown
  container.querySelectorAll('.opening-row').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.dxcc;
      const entry = cache[id];
      if (entry?.feature) openDrilldown(entry.feature);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') el.click();
    });
  });
}

// ─── Core scan ───────────────────────────────────────────────────────────────
/**
 * Scan scoreCache for bands that will cross OPEN_THRESHOLD
 * within the next LOOK_AHEAD_STEPS from currentStep.
 *
 * Returns array of opening objects:
 *  { dxccId, name, prefix, continent, band, stepsUntil, peakScore, deltaScore }
 */
function findOpenings(cache, currentStep) {
  const openings = [];

  for (const [dxccId, entry] of Object.entries(cache)) {
    const steps = entry.steps ?? {};

    for (const band of ALL_BANDS) {
      // Current score
      const nowScore = steps[currentStep]?.[band] ?? 0;

      // Already well open → not an "opening"
      if (nowScore >= OPEN_THRESHOLD) continue;

      // Scan ahead
      let bestScore    = nowScore;
      let bestStep     = -1;

      for (let i = 1; i <= LOOK_AHEAD_STEPS; i++) {
        const futureStep = (currentStep + i) % 48;
        const futureScore = steps[futureStep]?.[band] ?? 0;

        if (futureScore >= OPEN_THRESHOLD && futureScore > bestScore) {
          bestScore = futureScore;
          bestStep  = i;
        }
      }

      if (bestStep < 0) continue; // no opening found

      const delta = bestScore - nowScore;
      if (delta < 10) continue; // negligible improvement

      openings.push({
        dxccId,
        name:       entry.name    ?? dxccId,
        prefix:     entry.prefix  ?? '?',
        continent:  entry.continent ?? '—',
        band,
        stepsUntil: bestStep,
        peakScore:  bestScore,
        deltaScore: delta,
      });
    }
  }

  return openings;
}

// ─── Util ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
