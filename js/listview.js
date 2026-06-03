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
const CONTINENT_FLAGS = { EU: '🇪🇺', NA: '🌎', SA: '🌎', AS: '🌏', OC: '🌏', AF: '🌍', AN: '🧊' };

function getScoreTier(score) {
  if (score >= 76) return 'excellent';
  if (score >= 51) return 'good';
  if (score >= 31) return 'moderate';
  if (score >= 16) return 'poor';
  if (score >= 1)  return 'marginal';
  return 'closed';
}

function getHopCount(distKm) {
  if (!distKm) return 0;
  return Math.max(1, Math.ceil(distKm / 3500));
}


export function updateListview() {
  updateByBand();
  updateByRegion();
}

// ─── By Band screen ───────────────────────────────────────────────────────────
export function updateByBand() {
  const container = document.getElementById('screen-by-band');
  if (!container) return;

  const cache      = state.scoreCache;
  const step       = state.activeTimeOffset;
  const activeBand = state.activeBand;
  const threshold  = state.user.thresholdPct ?? 40;

  if (!state.scoreCacheBuilt || !cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  // Build sorted entries per continent
  const grouped = {};
  for (const [id, entry] of Object.entries(cache)) {
    const cont   = entry.continent ?? 'EU';
    const score  = entry.steps?.[step]?.[activeBand] ?? 0;
    if (!grouped[cont]) grouped[cont] = [];
    grouped[cont].push({ id, entry, score });
  }

  // Sort each continent: score descending
  for (const cont of Object.keys(grouped)) {
    grouped[cont].sort((a, b) => b.score - a.score);
  }

  // Sort continents by best score descending
  const sortedConts = Object.keys(grouped).sort((a, b) => {
    const bestA = grouped[a][0]?.score ?? 0;
    const bestB = grouped[b][0]?.score ?? 0;
    return bestB - bestA;
  });

  // Count totals for header
  const totalReachable = Object.values(grouped).flat().filter(e => e.score >= threshold).length;
  const totalEntities  = Object.values(grouped).flat().length;

  let html = `
    <div class="listview-toolbar">
      <div class="listview-band-info">
        <span class="lv-band-badge">${activeBand}</span>
        <span class="lv-reach-count">${totalReachable} / ${totalEntities} reachable</span>
      </div>
      <label class="lv-filter-wrap">
        <input type="checkbox" id="lv-filter-open" ${state.lvFilterOpen ? 'checked' : ''}>
        <span>Reachable only (≥${threshold}%)</span>
      </label>
    </div>
  `;

  for (const cont of sortedConts) {
    const rows   = grouped[cont];
    const reachable = rows.filter(e => e.score >= threshold).length;
    const bestScore = rows[0]?.score ?? 0;
    const contName  = CONTINENT_NAMES[cont] ?? cont;
    const contClass = `score-color-${getScoreTier(bestScore)}`;

    html += `
      <div class="listview-group" data-cont="${cont}">
        <div class="listview-group-header" role="button" tabindex="0" aria-expanded="true">
          <span class="cont-flag">${CONTINENT_FLAGS[cont] ?? ''}</span>
          <span class="listview-continent">${contName}</span>
          <span class="lv-reach-badge ${reachable > 0 ? 'has-reach' : ''}">${reachable} open</span>
          <span class="lv-group-arrow">▾</span>
        </div>
        <div class="listview-group-body">
    `;

    for (const { id, entry, score } of rows) {
      const tier  = getScoreTier(score);
      const hops  = getHopCount(entry.distKm ?? 0);
      const dist  = entry.distKm ? Math.round(entry.distKm) + ' km' : '—';
      const hidden = (state.lvFilterOpen && score < threshold) ? ' lv-hidden' : '';
      html += `
        <div class="lv-row${hidden}" data-id="${id}" role="button" tabindex="0">
          <div class="lv-row-left">
            <span class="lv-prefix">${entry.prefix}</span>
            <span class="lv-name">${entry.name}</span>
          </div>
          <div class="lv-row-right">
            <div class="lv-score-bar-wrap">
              <div class="lv-score-bar score-bg-${tier}" style="width:${score}%"></div>
            </div>
            <span class="lv-score-pct score-text-${tier}">${score}%</span>
            <span class="lv-dist">${dist}</span>
          </div>
        </div>
      `;
    }

    html += `</div></div>`;
  }

  if (!html.includes('lv-row')) {
    html += `<div class="list-empty">${t('ui.no_results')}</div>`;
  }

  container.innerHTML = html;

  // Filter toggle
  const filterCb = container.querySelector('#lv-filter-open');
  filterCb?.addEventListener('change', () => {
    state.lvFilterOpen = filterCb.checked;
    updateByBand();
  });

  // Collapse/expand groups
  container.querySelectorAll('.listview-group-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body  = hdr.nextElementSibling;
      const arrow = hdr.querySelector('.lv-group-arrow');
      const open  = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      if (arrow) arrow.textContent = open ? '▸' : '▾';
      hdr.setAttribute('aria-expanded', String(!open));
    });
  });

  // Row click → drilldown
  container.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const id    = row.dataset.id;
      const entry = cache[id];
      if (entry?.feature) openDrilldown(entry.feature);
    });
  });
}


export function updateByRegion() {
  const container = document.getElementById('screen-by-region');
  if (!container) return;

  const step  = state.activeTimeOffset;
  const cache = state.scoreCache;

  if (!cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  // Selected region/DXCC from state (null = show continent list)
  const selectedCont = state.selectedContinent ?? null;

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
      state.selectedContinent = el.dataset.cont;
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
    state.selectedContinent = null;
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
export { updateListview as update };import { state, ALL_BANDS, scoreColorVar, scoreClass } from './state.js';
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

  const cache      = state.scoreCache;
  const step       = state.activeTimeOffset;
  const activeBand = state.activeBand;
  const threshold  = state.user.thresholdPct ?? 40;

  if (!state.scoreCacheBuilt || !cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  // Build sorted entries per continent
  const grouped = {};
  for (const [id, entry] of Object.entries(cache)) {
    const cont   = entry.continent ?? 'EU';
    const score  = entry.steps?.[step]?.[activeBand] ?? 0;
    if (!grouped[cont]) grouped[cont] = [];
    grouped[cont].push({ id, entry, score });
  }

  // Sort each continent: score descending
  for (const cont of Object.keys(grouped)) {
    grouped[cont].sort((a, b) => b.score - a.score);
  }

  // Sort continents by best score descending
  const sortedConts = Object.keys(grouped).sort((a, b) => {
    const bestA = grouped[a][0]?.score ?? 0;
    const bestB = grouped[b][0]?.score ?? 0;
    return bestB - bestA;
  });

  // Count totals for header
  const totalReachable = Object.values(grouped).flat().filter(e => e.score >= threshold).length;
  const totalEntities  = Object.values(grouped).flat().length;

  let html = `
    <div class="listview-toolbar">
      <div class="listview-band-info">
        <span class="lv-band-badge">${activeBand}</span>
        <span class="lv-reach-count">${totalReachable} / ${totalEntities} reachable</span>
      </div>
      <label class="lv-filter-wrap">
        <input type="checkbox" id="lv-filter-open" ${state.lvFilterOpen ? 'checked' : ''}>
        <span>Reachable only (≥${threshold}%)</span>
      </label>
    </div>
  `;

  for (const cont of sortedConts) {
    const rows   = grouped[cont];
    const reachable = rows.filter(e => e.score >= threshold).length;
    const bestScore = rows[0]?.score ?? 0;
    const contName  = CONTINENT_NAMES[cont] ?? cont;
    const contClass = `score-color-${getScoreTier(bestScore)}`;

    html += `
      <div class="listview-group" data-cont="${cont}">
        <div class="listview-group-header" role="button" tabindex="0" aria-expanded="true">
          <span class="cont-flag">${CONTINENT_FLAGS[cont] ?? ''}</span>
          <span class="listview-continent">${contName}</span>
          <span class="lv-reach-badge ${reachable > 0 ? 'has-reach' : ''}">${reachable} open</span>
          <span class="lv-group-arrow">▾</span>
        </div>
        <div class="listview-group-body">
    `;

    for (const { id, entry, score } of rows) {
      const tier  = getScoreTier(score);
      const hops  = getHopCount(entry.distKm ?? 0);
      const dist  = entry.distKm ? Math.round(entry.distKm) + ' km' : '—';
      const hidden = (state.lvFilterOpen && score < threshold) ? ' lv-hidden' : '';
      html += `
        <div class="lv-row${hidden}" data-id="${id}" role="button" tabindex="0">
          <div class="lv-row-left">
            <span class="lv-prefix">${entry.prefix}</span>
            <span class="lv-name">${entry.name}</span>
          </div>
          <div class="lv-row-right">
            <div class="lv-score-bar-wrap">
              <div class="lv-score-bar score-bg-${tier}" style="width:${score}%"></div>
            </div>
            <span class="lv-score-pct score-text-${tier}">${score}%</span>
            <span class="lv-dist">${dist}</span>
          </div>
        </div>
      `;
    }

    html += `</div></div>`;
  }

  if (!html.includes('lv-row')) {
    html += `<div class="list-empty">${t('ui.no_results')}</div>`;
  }

  container.innerHTML = html;

  // Filter toggle
  const filterCb = container.querySelector('#lv-filter-open');
  filterCb?.addEventListener('change', () => {
    state.lvFilterOpen = filterCb.checked;
    updateByBand();
  });

  // Collapse/expand groups
  container.querySelectorAll('.listview-group-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body  = hdr.nextElementSibling;
      const arrow = hdr.querySelector('.lv-group-arrow');
      const open  = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      if (arrow) arrow.textContent = open ? '▸' : '▾';
      hdr.setAttribute('aria-expanded', String(!open));
    });
  });

  // Row click → drilldown
  container.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const id    = row.dataset.id;
      const entry = cache[id];
      if (entry?.feature) openDrilldown(entry.feature);
    });
  });
}


export function updateByRegion() {
  const container = document.getElementById('screen-by-region');
  if (!container) return;

  const step  = state.activeTimeOffset;
  const cache = state.scoreCache;

  if (!cache || Object.keys(cache).length === 0) {
    container.innerHTML = `<div class="list-empty">${t('ui.loading')}</div>`;
    return;
  }

  // Selected region/DXCC from state (null = show continent list)
  const selectedCont = state.selectedContinent ?? null;

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
      state.selectedContinent = el.dataset.cont;
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
    state.selectedContinent = null;
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
