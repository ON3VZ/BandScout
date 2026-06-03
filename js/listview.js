/**
 * listview.js — By Band and By Region list views.
 * Displays propagation scores grouped by continent.
 */
import { state, ALL_BANDS } from './state.js';
import { t } from './i18n.js';
import { openDrilldown } from './drilldown.js';

const CONT_NAMES  = { EU:'Europe', NA:'N. America', SA:'S. America', AS:'Asia', OC:'Oceania', AF:'Africa', AN:'Antarctica' };
const CONT_FLAGS  = { EU:'🌍', NA:'🌎', SA:'🌎', AS:'🌏', OC:'🌏', AF:'🌍', AN:'🧊' };
const CONT_ORDER  = ['EU','AS','NA','SA','AF','OC','AN'];

function tier(s) {
  if (s >= 76) return 'excellent';
  if (s >= 51) return 'good';
  if (s >= 31) return 'moderate';
  if (s >= 16) return 'poor';
  if (s >= 1)  return 'marginal';
  return 'closed';
}

export function updateListview() {
  updateByBand();
  updateByRegion();
}

// ──────────────────────────────────────────────────────────────────────────────
export function updateByBand() {
  const el = document.getElementById('screen-by-band');
  if (!el) return;

  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;
  const band  = state.activeBand;
  const thr   = state.user.thresholdPct ?? 40;

  if (!state.scoreCacheBuilt || !Object.keys(cache).length) {
    el.innerHTML = '<div class="list-empty">Loading…</div>';
    return;
  }

  // Group entries by continent
  const groups = {};
  for (const [id, entry] of Object.entries(cache)) {
    const cont  = entry.continent ?? 'EU';
    const score = entry.steps?.[step]?.[band] ?? 0;
    (groups[cont] = groups[cont] || []).push({ id, entry, score });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score);

  const filterOpen  = state.lvFilterOpen ?? false;
  const totalReach  = Object.values(groups).flat().filter(e => e.score >= thr).length;
  const total       = Object.values(groups).flat().length;
  const sortedConts = CONT_ORDER.filter(c => groups[c])
    .concat(Object.keys(groups).filter(c => !CONT_ORDER.includes(c)));

  let html = `<div class="lv-toolbar">
    <span class="lv-band-chip">${band}</span>
    <span class="lv-summary">${totalReach}/${total} reachable</span>
    <label class="lv-toggle"><input type="checkbox" id="lv-cb"${filterOpen ? ' checked' : ''}> ≥${thr}% only</label>
  </div>`;

  for (const cont of sortedConts) {
    const rows  = groups[cont];
    const reach = rows.filter(r => r.score >= thr).length;
    html += `<div class="lv-group">
      <div class="lv-group-hdr">
        ${CONT_FLAGS[cont] ?? ''} <span class="lv-cont-name">${CONT_NAMES[cont] ?? cont}</span>
        <span class="lv-open-badge${reach > 0 ? ' open' : ''}">${reach} open</span>
        <span class="lv-arrow">▾</span>
      </div><div class="lv-group-body">`;

    for (const { id, entry, score } of rows) {
      const t2   = tier(score);
      const hide = filterOpen && score < thr ? ' lv-hide' : '';
      html += `<div class="lv-row${hide}" data-id="${id}">
        <span class="lv-pfx">${entry.prefix}</span>
        <span class="lv-name">${entry.name}</span>
        <div class="lv-bar-wrap"><div class="lv-bar ${t2}" style="width:${score}%"></div></div>
        <span class="lv-pct ${t2}">${score}%</span>
      </div>`;
    }
    html += '</div></div>';
  }

  el.innerHTML = html;

  el.querySelector('#lv-cb')?.addEventListener('change', e => {
    state.lvFilterOpen = e.target.checked; updateByBand();
  });
  el.querySelectorAll('.lv-group-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      const arr = hdr.querySelector('.lv-arrow');
      if (arr) arr.textContent = open ? '▸' : '▾';
    });
  });
  el.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const e = cache[row.dataset.id];
      if (e?.feature) openDrilldown(e.feature);
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
export function updateByRegion() {
  const el = document.getElementById('screen-by-region');
  if (!el) return;

  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;

  if (!state.scoreCacheBuilt || !Object.keys(cache).length) {
    el.innerHTML = '<div class="list-empty">Loading…</div>';
    return;
  }

  const selected = state.selectedContinent;

  if (!selected) {
    // Continent overview
    const contData = {};
    for (const entry of Object.values(cache)) {
      const cont = entry.continent ?? 'EU';
      if (!contData[cont]) contData[cont] = { best: 0, bestBand: '—', count: 0 };
      for (const [b, s] of Object.entries(entry.steps?.[step] ?? {})) {
        if (s > contData[cont].best) { contData[cont].best = s; contData[cont].bestBand = b; }
      }
      contData[cont].count++;
    }
    let html = '<div class="lv-toolbar"><span class="lv-summary">Select a continent</span></div>';
    for (const cont of CONT_ORDER.filter(c => contData[c])) {
      const d  = contData[cont];
      const t2 = tier(d.best);
      html += `<div class="byregion-cont" data-cont="${cont}">
        <span>${CONT_FLAGS[cont] ?? ''} ${CONT_NAMES[cont] ?? cont}</span>
        <span class="lv-band-chip">${d.bestBand}</span>
        <span class="lv-pct ${t2}">${d.best}%</span>
        <span class="lv-count">${d.count} entities</span>
      </div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('.byregion-cont').forEach(row => {
      row.addEventListener('click', () => { state.selectedContinent = row.dataset.cont; updateByRegion(); });
    });
    return;
  }

  // Entity list for selected continent
  const rows = Object.entries(cache)
    .filter(([, e]) => (e.continent ?? 'EU') === selected)
    .map(([id, entry]) => {
      const scores = entry.steps?.[step] ?? {};
      const best   = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      return { id, entry, bestBand: best?.[0] ?? '—', bestScore: best?.[1] ?? 0, scores };
    })
    .sort((a, b) => b.bestScore - a.bestScore);

  let html = `<div class="lv-toolbar">
    <button class="lv-back-btn" id="lv-back">← Back</button>
    <span class="lv-cont-name">${CONT_FLAGS[selected] ?? ''} ${CONT_NAMES[selected] ?? selected}</span>
  </div>`;

  for (const { id, entry, bestBand, bestScore, scores } of rows) {
    const t2 = tier(bestScore);
    const bands = ALL_BANDS.filter(b => scores[b] !== undefined)
      .map(b => `<span class="mini-b ${tier(scores[b])}" title="${b}:${scores[b]}%">${b}</span>`).join('');
    html += `<div class="lv-row" data-id="${id}">
      <span class="lv-pfx">${entry.prefix}</span>
      <span class="lv-name">${entry.name}</span>
      <div class="mini-bands">${bands}</div>
      <span class="lv-pct ${t2}">${bestScore}%</span>
    </div>`;
  }
  el.innerHTML = html;

  el.querySelector('#lv-back')?.addEventListener('click', () => { state.selectedContinent = null; updateByRegion(); });
  el.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const e = cache[row.dataset.id];
      if (e?.feature) openDrilldown(e.feature);
    });
  });
}
