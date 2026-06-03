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

  const cache     = state.scoreCache;
  const threshold = state.user.thresholdPct ?? 40;
  const horizon   = (state.user.openingSoonHours ?? 2) * 2; // steps

  if (!state.scoreCacheBuilt || !cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  const now = state.activeTimeOffset;

  // Scan alle band/entity combo's voor openings
  const openings = [];
  const activeBands = Object.keys(
    Object.values(cache)[0]?.steps?.[0] ?? {}
  );

  for (const [id, entry] of Object.entries(cache)) {
    const curScores = entry.steps?.[now] ?? {};

    for (const band of activeBands) {
      const curScore = curScores[band] ?? 0;
      if (curScore >= threshold) continue; // al open

      // Zoek eerste stap in horizon dat de drempel overschrijdt
      let peakScore = curScore;
      let openStep  = -1;

      for (let s = now + 1; s <= now + horizon && s < 48; s++) {
        const sc = entry.steps?.[s]?.[band] ?? 0;
        if (sc > peakScore) peakScore = sc;
        if (sc >= threshold && openStep < 0) openStep = s;
      }

      if (openStep < 0 || peakScore < threshold) continue;

      const minutesUntil = (openStep - now) * 30;
      const delta        = peakScore - curScore;

      openings.push({
        id, entry, band,
        curScore, peakScore, delta,
        minutesUntil, openStep,
      });
    }
  }

  // Sorteer: snelste opening + grootste delta bovenaan
  openings.sort((a, b) => {
    if (a.minutesUntil !== b.minutesUntil) return a.minutesUntil - b.minutesUntil;
    return b.delta - a.delta;
  });

  const shown = openings.slice(0, 60); // max 60 resultaten

  if (shown.length === 0) {
    container.innerHTML = `
      <div class="opening-header">
        <span class="opening-horizon-label">${t('opening.title')} — next ${state.user.openingSoonHours ?? 2}h</span>
      </div>
      <div class="list-empty">${t('opening.none')}</div>`;
    return;
  }

  let html = `
    <div class="opening-header">
      <span class="opening-horizon-label">${t('opening.title')} — next ${state.user.openingSoonHours ?? 2}h</span>
      <span class="opening-count">${shown.length} band/region combos</span>
    </div>
  `;

  for (const o of shown) {
    const tier  = getOpenTier(o.peakScore);
    const arrow = o.delta >= 30 ? '🔥' : o.delta >= 15 ? '↑' : '↗';
    const timeStr = o.minutesUntil < 60
      ? `in ${o.minutesUntil} min`
      : `in ${Math.round(o.minutesUntil / 60 * 10) / 10}h`;

    html += `
      <div class="opening-row" data-id="${o.id}" data-band="${o.band}" role="button" tabindex="0">
        <div class="opening-row-left">
          <span class="opening-band-tag">${o.band}</span>
          <div class="opening-entity">
            <span class="opening-prefix">${o.entry.prefix}</span>
            <span class="opening-name">${o.entry.name}</span>
          </div>
        </div>
        <div class="opening-row-right">
          <span class="opening-time">${timeStr}</span>
          <span class="opening-arrow">${arrow}</span>
          <span class="opening-score score-text-${tier}">${o.peakScore}%</span>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Klik → drilldown
  container.querySelectorAll('.opening-row').forEach(row => {
    row.addEventListener('click', () => {
      const id    = row.dataset.id;
      const entry = cache[id];
      if (entry?.feature) {
        state.activeBand = row.dataset.band;
        openDrilldown(entry.feature);
      }
    });
  });
}

function getOpenTier(score) {
  if (score >= 76) return 'excellent';
  if (score >= 51) return 'good';
  if (score >= 31) return 'moderate';
  return 'poor';
}

