/**
 * listview.js — By Band and By Region screens
 */
import { state, ALL_BANDS, scoreColorVar, scoreClass } from './state.js';
import { t } from './i18n.js';
import { openDrilldown } from './drilldown.js';

const CONTINENT_NAMES = { EU:'Europe', NA:'N. America', SA:'S. America', AS:'Asia', OC:'Oceania', AF:'Africa', AN:'Antarctica' };
const CONTINENT_FLAGS = { EU:'🌍', NA:'🌎', SA:'🌎', AS:'🌏', OC:'🌏', AF:'🌍', AN:'🧊' };
const CONTINENT_ORDER = ['EU','AS','NA','SA','AF','OC','AN'];

function scoreTier(s) {
  if (s >= 76) return 'excellent';
  if (s >= 51) return 'good';
  if (s >= 31) return 'moderate';
  if (s >= 16) return 'poor';
  if (s >= 1)  return 'marginal';
  return 'closed';
}

// Called from app.js after cache build and on tab switch
export function updateListview() { updateByBand(); updateByRegion(); }

// ── By Band ───────────────────────────────────────────────────────────────────
export function updateByBand() {
  const el = document.getElementById('screen-by-band');
  if (!el) return;

  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;
  const band  = state.activeBand;
  const thr   = state.user.thresholdPct ?? 40;

  if (!state.scoreCacheBuilt || !cache || !Object.keys(cache).length) {
    el.innerHTML = `<div class="list-empty">Loading…</div>`; return;
  }

  // Group by continent
  const groups = {};
  for (const [id, entry] of Object.entries(cache)) {
    const cont  = entry.continent ?? 'EU';
    const score = entry.steps?.[step]?.[band] ?? 0;
    if (!groups[cont]) groups[cont] = [];
    groups[cont].push({ id, entry, score });
  }
  // Sort entries within each group
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score);

  const filterOpen = state.lvFilterOpen ?? false;
  const totalReach = Object.values(groups).flat().filter(e => e.score >= thr).length;
  const total      = Object.values(groups).flat().length;

  let html = `<div class="lv-toolbar">
    <span class="lv-band-chip">${band}</span>
    <span class="lv-summary">${totalReach}/${total} reachable</span>
    <label class="lv-toggle"><input type="checkbox" id="lv-cb" ${filterOpen ? 'checked' : ''}>
      <span>≥${thr}% only</span></label>
  </div>`;

  const sortedConts = CONTINENT_ORDER.filter(c => groups[c])
    .concat(Object.keys(groups).filter(c => !CONTINENT_ORDER.includes(c)));

  for (const cont of sortedConts) {
    const rows    = groups[cont];
    const reach   = rows.filter(r => r.score >= thr).length;
    const best    = rows[0]?.score ?? 0;
    const flag    = CONTINENT_FLAGS[cont] ?? '';
    const name    = CONTINENT_NAMES[cont] ?? cont;

    html += `<div class="lv-group">
      <div class="lv-group-hdr" data-cont="${cont}">
        <span>${flag}</span>
        <span class="lv-cont-name">${name}</span>
        <span class="lv-open-badge ${reach > 0 ? 'open' : ''}">${reach} open</span>
        <span class="lv-arrow">▾</span>
      </div><div class="lv-group-body">`;

    for (const { id, entry, score } of rows) {
      const tier = scoreTier(score);
      const hide = filterOpen && score < thr ? ' lv-hide' : '';
      const dist = entry.lat && entry.lon
        ? Math.round(Math.sqrt((entry.lat-state.user.lat)**2+(entry.lon-state.user.lon)**2)*111) + ' km'
        : '';
      html += `<div class="lv-row${hide}" data-id="${id}">
        <span class="lv-pfx">${entry.prefix}</span>
        <span class="lv-name">${entry.name}</span>
        <div class="lv-bar-wrap"><div class="lv-bar ${tier}" style="width:${score}%"></div></div>
        <span class="lv-pct ${tier}">${score}%</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  el.innerHTML = html;

  el.querySelector('#lv-cb')?.addEventListener('change', e => {
    state.lvFilterOpen = e.target.checked;
    updateByBand();
  });

  el.querySelectorAll('.lv-group-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling;
      const arr  = hdr.querySelector('.lv-arrow');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
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

// ── By Region ─────────────────────────────────────────────────────────────────
export function updateByRegion() {
  const el = document.getElementById('screen-by-region');
  if (!el) return;

  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;

  if (!state.scoreCacheBuilt || !cache || !Object.keys(cache).length) {
    el.innerHTML = `<div class="list-empty">Loading…</div>`; return;
  }

  const selected = state.selectedContinent;

  if (!selected) {
    // Show continent overview
    const contData = {};
    for (const entry of Object.values(cache)) {
      const cont = entry.continent ?? 'EU';
      if (!contData[cont]) contData[cont] = { best: 0, bestBand: '—', count: 0 };
      const scores = Object.entries(entry.steps?.[step] ?? {});
      for (const [b, s] of scores) {
        if (s > contData[cont].best) { contData[cont].best = s; contData[cont].bestBand = b; }
      }
      contData[cont].count++;
    }

    let html = `<div class="lv-toolbar"><span class="lv-summary">Tap a continent</span></div>`;
    for (const cont of CONTINENT_ORDER.filter(c => contData[c])) {
      const d    = contData[cont];
      const tier = scoreTier(d.best);
      html += `<div class="byregion-cont" data-cont="${cont}">
        <span>${CONTINENT_FLAGS[cont] ?? ''} ${CONTINENT_NAMES[cont] ?? cont}</span>
        <span class="lv-band-chip">${d.bestBand}</span>
        <span class="lv-pct ${tier}">${d.best}%</span>
        <span class="lv-count">${d.count} entities</span>
      </div>`;
    }
    el.innerHTML = html;

    el.querySelectorAll('.byregion-cont').forEach(row => {
      row.addEventListener('click', () => {
        state.selectedContinent = row.dataset.cont;
        updateByRegion();
      });
    });
    return;
  }

  // Show entities in selected continent
  const rows = Object.entries(cache)
    .filter(([, e]) => (e.continent ?? 'EU') === selected)
    .map(([id, entry]) => {
      const scores  = entry.steps?.[step] ?? {};
      const bands   = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      const best    = bands[0];
      return { id, entry, bestBand: best?.[0] ?? '—', bestScore: best?.[1] ?? 0, scores };
    })
    .sort((a, b) => b.bestScore - a.bestScore);

  const contName = CONTINENT_NAMES[selected] ?? selected;
  let html = `<div class="lv-toolbar">
    <button class="lv-back-btn" id="lv-back">← Back</button>
    <span class="lv-cont-name">${CONTINENT_FLAGS[selected] ?? ''} ${contName}</span>
  </div>`;

  for (const { id, entry, bestBand, bestScore, scores } of rows) {
    const tier = scoreTier(bestScore);
    // Mini band score strip
    const bandStrip = ALL_BANDS
      .filter(b => scores[b] !== undefined)
      .map(b => {
        const s = scores[b] ?? 0;
        const t2 = scoreTier(s);
        return `<span class="mini-band ${t2}" title="${b}: ${s}%">${b}</span>`;
      }).join('');

    html += `<div class="lv-row" data-id="${id}">
      <span class="lv-pfx">${entry.prefix}</span>
      <span class="lv-name">${entry.name}</span>
      <div class="mini-bands">${bandStrip}</div>
      <span class="lv-pct ${tier}">${bestScore}%</span>
    </div>`;
  }

  el.innerHTML = html;

  el.querySelector('#lv-back')?.addEventListener('click', () => {
    state.selectedContinent = null;
    updateByRegion();
  });

  el.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const e = cache[row.dataset.id];
      if (e?.feature) openDrilldown(e.feature);
    });
  });
}
