/**
 * listview.js
 * Renders "By Band" and "By Region" screens.
 * Called from timeline.js whenever the active time step or band changes.
 */

import { state, ALL_BANDS, scoreColorVar, scoreClass } from './state.js';
import { t } from './i18n.js';
import { openDrilldown } from './drilldown.js';

// ─── IARU continent/region grouping ─────────────────────────────────────────
const CONTINENT_ORDER = ['EU','NA','SA','AF','AS','OC','AN'];
const CONTINENT_NAMES = {
  EU: 'Europe', NA: 'North America', SA: 'South America',
  AF: 'Africa', AS: 'Asia', OC: 'Oceania', AN: 'Antarctica',
};

// ─── Main update entry point ─────────────────────────────────────────────────
/**
 * Call whenever time step, band, or cache changes.
 * Determines which screen is active and renders it.
 */
export function updateListview() {
  updateByBand();
  updateByRegion();
}

// ─── By Band screen ───────────────────────────────────────────────────────────
export function updateByBand() {
  const container = document.getElementById('screen-by-band');
  if (!container) return;

  const step      = state.ui.timeStep;
  const cache     = state.scoreCache;
  const activeBand= state.ui.selectedBand;

  if (!cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  // Collect all DXCC entries visible in cache
  const dxccIds = Object.keys(cache);
  if (dxccIds.length === 0) {
    container.innerHTML = `<div class="list-empty">${t('listview.no_data')}</div>`;
    return;
  }

  // Group by continent
  const grouped = {};
  for (const id of dxccIds) {
    const entry = cache[id];
    const cont = entry.continent ?? 'EU';
    if (!grouped[cont]) grouped[cont] = [];

    // Score for active band at this step
    const bandScores = entry.steps?.[step] ?? {};
    const score = bandScores[activeBand] ?? 0;
    const mini24h = buildMini24h(entry, activeBand);

    grouped[cont].push({
      id,
      name:     entry.name,
      prefix:   entry.prefix,
      score,
      mini24h,
      feature:  entry.feature,
    });
  }

  // Sort each group by score descending
  for (const cont of Object.keys(grouped)) {
    grouped[cont].sort((a, b) => b.score - a.score);
  }

  // Render
  let html = '';

  // Band selector header (rendered above list by layout, but also put best stats here)
  const allScores = dxccIds.map(id => {
    const bandScores = cache[id]?.steps?.[step] ?? {};
    return bandScores[activeBand] ?? 0;
  });
  const reachable  = allScores.filter(s => s >= 20).length;
  const excellent  = allScores.filter(s => s >= 80).length;

  html += `<div class="listview-summary">
    <span>${t('listview.reachable', { n: reachable })}</span>
    <span>${t('listview.excellent', { n: excellent })}</span>
  </div>`;

  for (const cont of CONTINENT_ORDER) {
    const rows = grouped[cont];
    if (!rows || rows.length === 0) continue;

    html += `<div class="listview-group">
      <div class="listview-group-header">
        <span class="listview-continent">${CONTINENT_NAMES[cont] ?? cont}</span>
        <span class="listview-group-count">${rows.length}</span>
      </div>`;

    for (const row of rows) {
      const sc     = scoreClass(row.score);
      const pct    = row.score;
      html += `
        <div class="listview-row" data-dxcc="${escHtml(row.id)}" role="button" tabindex="0"
             aria-label="${escHtml(row.name)} – ${row.score}%">
          <div class="listview-row-left">
            <span class="listview-prefix">${escHtml(row.prefix)}</span>
            <span class="listview-name">${escHtml(row.name)}</span>
          </div>
          <div class="listview-row-right">
            <div class="listview-mini24h" aria-hidden="true">
              ${row.mini24h.map(v =>
                `<span class="mini-bar ${scoreClass(v)}" style="height:${Math.max(2, v)}%"></span>`
              ).join('')}
            </div>
            <div class="score-bar-wrap">
              <div class="score-bar ${sc}" style="width:${pct}%"></div>
            </div>
            <span class="listview-score ${sc}">${row.score}</span>
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;

  // Bind click → drilldown
  container.querySelectorAll('.listview-row').forEach(el => {
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

// ─── By Region screen ────────────────────────────────────────────────────────
export function updateByRegion() {
  const container = document.getElementById('screen-by-region');
  if (!container) return;

  const step  = state.ui.timeStep;
  const cache = state.scoreCache;

  if (!cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  // Selected region/DXCC from state (null = show continent list)
  const selectedCont = state.ui.selectedContinent ?? null;

  if (!selectedCont) {
    renderContinentList(container, cache, step);
  } else {
    renderDxccList(container, cache, step, selectedCont);
  }
}

function renderContinentList(container, cache, step) {
  // Aggregate best score per continent across all bands at this step
  const contData = {};

  for (const id of Object.keys(cache)) {
    const entry = cache[id];
    const cont  = entry.continent ?? 'EU';
    const bandScores = entry.steps?.[step] ?? {};
    const bestScore = Math.max(0, ...Object.values(bandScores));
    const bestBand  = Object.entries(bandScores).sort((a,b) => b[1]-a[1])[0]?.[0] ?? '—';

    if (!contData[cont]) contData[cont] = { best: 0, bestBand: '—', count: 0, reachable: 0 };
    contData[cont].count++;
    if (bestScore > contData[cont].best) {
      contData[cont].best = bestScore;
      contData[cont].bestBand = bestBand;
    }
    if (bestScore >= 20) contData[cont].reachable++;
  }

  let html = `<div class="byregion-header">
    <span class="byregion-hint">${t('listview.tap_region')}</span>
  </div>`;

  for (const cont of CONTINENT_ORDER) {
    const d = contData[cont];
    if (!d) continue;
    const sc = scoreClass(d.best);
    html += `
      <div class="byregion-continent-row" data-cont="${cont}" role="button" tabindex="0">
        <div class="byregion-cont-left">
          <span class="byregion-cont-name">${CONTINENT_NAMES[cont] ?? cont}</span>
          <span class="byregion-cont-sub">${d.reachable} / ${d.count} ${t('listview.reachable_short')}</span>
        </div>
        <div class="byregion-cont-right">
          <span class="band-tag">${d.bestBand}</span>
          <span class="listview-score ${sc}">${d.best}</span>
          <span class="byregion-chevron">›</span>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.byregion-continent-row').forEach(el => {
    el.addEventListener('click', () => {
      state.ui.selectedContinent = el.dataset.cont;
      updateByRegion();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') el.click();
    });
  });
}

function renderDxccList(container, cache, step, cont) {
  const contName = CONTINENT_NAMES[cont] ?? cont;
  const rows = [];

  for (const id of Object.keys(cache)) {
    const entry = cache[id];
    if ((entry.continent ?? 'EU') !== cont) continue;

    const bandScores = entry.steps?.[step] ?? {};
    // Build per-band row
    const bandRows = ALL_BANDS
      .filter(b => typeof bandScores[b] === 'number')
      .map(b => ({
        band:    b,
        score:   bandScores[b],
        mini24h: buildMini24h(entry, b),
      }))
      .sort((a, b) => b.score - a.score);

    if (bandRows.length === 0) continue;

    rows.push({
      id,
      name:    entry.name,
      prefix:  entry.prefix,
      best:    bandRows[0]?.score ?? 0,
      bestBand:bandRows[0]?.band ?? '—',
      bandRows,
      feature: entry.feature,
    });
  }

  rows.sort((a, b) => b.best - a.best);

  let html = `
    <div class="byregion-back-row">
      <button class="byregion-back" id="byregion-back">← ${t('listview.back')}</button>
      <span class="byregion-cont-title">${contName}</span>
    </div>`;

  for (const row of rows) {
    const sc = scoreClass(row.best);
    html += `
      <div class="byregion-dxcc-row" data-dxcc="${escHtml(row.id)}">
        <div class="byregion-dxcc-header" role="button" tabindex="0">
          <span class="listview-prefix">${escHtml(row.prefix)}</span>
          <span class="listview-name">${escHtml(row.name)}</span>
          <span class="band-tag">${row.bestBand}</span>
          <span class="listview-score ${sc}">${row.best}</span>
          <span class="byregion-chevron byregion-toggle">›</span>
        </div>
        <div class="byregion-dxcc-bands hidden">
          ${row.bandRows.map(br => {
            const bsc = scoreClass(br.score);
            return `
              <div class="byregion-band-row" data-dxcc="${escHtml(row.id)}">
                <span class="band-tag">${br.band}</span>
                <div class="listview-mini24h" aria-hidden="true">
                  ${br.mini24h.map(v =>
                    `<span class="mini-bar ${scoreClass(v)}" style="height:${Math.max(2, v)}%"></span>`
                  ).join('')}
                </div>
                <div class="score-bar-wrap">
                  <div class="score-bar ${bsc}" style="width:${br.score}%"></div>
                </div>
                <span class="listview-score ${bsc}">${br.score}</span>
              </div>`;
          }).join('')}
          <button class="btn-link byregion-open-drill" data-dxcc="${escHtml(row.id)}">
            ${t('listview.open_drilldown')} →
          </button>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  // Back button
  document.getElementById('byregion-back')?.addEventListener('click', () => {
    state.ui.selectedContinent = null;
    updateByRegion();
  });

  // Expand/collapse per DXCC
  container.querySelectorAll('.byregion-dxcc-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const parent = hdr.closest('.byregion-dxcc-row');
      const bands  = parent?.querySelector('.byregion-dxcc-bands');
      const chev   = hdr.querySelector('.byregion-toggle');
      if (!bands) return;
      const open = !bands.classList.contains('hidden');
      bands.classList.toggle('hidden', open);
      if (chev) chev.textContent = open ? '›' : '⌄';
    });
    hdr.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') hdr.click();
    });
  });

  // Open drilldown buttons
  container.querySelectorAll('.byregion-open-drill').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dxcc;
      const entry = cache[id];
      if (entry?.feature) openDrilldown(entry.feature);
    });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Build 48-entry mini 24h chart data (scores 0–100) for a given DXCC + band.
 */
function buildMini24h(entry, band) {
  const steps = entry.steps ?? {};
  return Array.from({ length: 48 }, (_, i) => steps[i]?.[band] ?? 0);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Alias for timeline.js compatibility
export { updateListview as update };
