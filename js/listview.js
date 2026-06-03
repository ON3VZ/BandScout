/**
 * listview.js — By Band + By Region
 * Inklapbare continent-groepen, score bars, klikbare rijen.
 */
import { state, ALL_BANDS } from './state.js';
import { t } from './i18n.js';
import { openDrilldown } from './drilldown.js';

const CONT = {
  EU: { name: 'Europe',     flag: '🌍' },
  AS: { name: 'Asia',       flag: '🌏' },
  NA: { name: 'N. America', flag: '🌎' },
  SA: { name: 'S. America', flag: '🌎' },
  AF: { name: 'Africa',     flag: '🌍' },
  OC: { name: 'Oceania',    flag: '🌏' },
  AN: { name: 'Antarctica', flag: '🧊' },
};
const CONT_ORDER = ['EU','AS','NA','SA','AF','OC','AN'];

// Open/dicht geheugen per continent
const openState = { band: {}, region: {} };

function tier(s) {
  if (s >= 76) return 'exc';
  if (s >= 51) return 'good';
  if (s >= 31) return 'mod';
  if (s >= 16) return 'poor';
  if (s >= 1)  return 'marg';
  return 'nil';
}

function bar(s)  { return `<div class="sb-wrap"><div class="sb ${tier(s)}" style="width:${s}%"></div></div>`; }
function pct(s)  { return `<span class="spct ${tier(s)}">${s}%</span>`; }

export function updateListview() { updateByBand(); updateByRegion(); }

// ─── By Band ─────────────────────────────────────────────────────────────────
export function updateByBand() {
  const el = document.getElementById('screen-by-band');
  if (!el) return;
  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;
  const band  = state.activeBand;
  const thr   = state.user.thresholdPct ?? 40;

  if (!state.scoreCacheBuilt || !Object.keys(cache).length) {
    el.innerHTML = '<div class="lv-empty">⏳ Laden…</div>'; return;
  }

  const groups = {};
  for (const [id, entry] of Object.entries(cache)) {
    const cont  = entry.continent ?? 'EU';
    const score = entry.steps?.[step]?.[band] ?? 0;
    (groups[cont] = groups[cont] || []).push({ id, entry, score });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score);

  const filterOpen = state.lvFilterOpen ?? false;
  const allE = Object.values(groups).flat();
  const reach = allE.filter(e => e.score >= thr).length;

  let html = `
  <div class="lv-top">
    <div class="lv-top-l">
      <span class="lv-chip">${band}</span>
      <span class="lv-sum">${reach} / ${allE.length} bereikbaar</span>
    </div>
    <label class="lv-chk"><input type="checkbox" id="lv-cb"${filterOpen?' checked':''}> ≥${thr}% only</label>
  </div>
  <div class="lv-scroll">`;

  const sorted = CONT_ORDER.filter(c => groups[c])
    .concat(Object.keys(groups).filter(c => !CONT_ORDER.includes(c)));

  for (const cont of sorted) {
    const rows   = groups[cont];
    const nr     = rows.filter(r => r.score >= thr).length;
    const best   = rows[0]?.score ?? 0;
    const info   = CONT[cont] ?? { name: cont, flag: '🌐' };
    const isOpen = openState.band[cont] !== false;

    html += `
    <div class="lv-group">
      <div class="lv-ghdr${nr > 0 ? ' has-r' : ''}" data-cont="${cont}">
        <span class="lv-flag">${info.flag}</span>
        <span class="lv-cname">${info.name}</span>
        <span class="lv-rbadge${nr > 0 ? ' open' : ''}">${nr} open</span>
        ${bar(best)}${pct(best)}
        <span class="lv-chev">${isOpen ? '▾' : '▸'}</span>
      </div>
      <div class="lv-gbody"${isOpen ? '' : ' style="display:none"'}>`;

    for (const { id, entry, score } of rows) {
      const hide = (filterOpen && score < thr) ? ' lv-hide' : '';
      html += `
        <div class="lv-row${hide}" data-id="${id}">
          <span class="lv-pfx">${entry.prefix}</span>
          <span class="lv-nm">${entry.name}</span>
          ${bar(score)}${pct(score)}
        </div>`;
    }
    html += '</div></div>';
  }

  html += '</div>'; // end lv-scroll
  el.innerHTML = html;
  bindBand(el, cache, thr);
}

function bindBand(el, cache, thr) {
  el.querySelector('#lv-cb')?.addEventListener('change', e => {
    state.lvFilterOpen = e.target.checked; updateByBand();
  });
  el.querySelectorAll('.lv-ghdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body   = hdr.nextElementSibling;
      const cont   = hdr.dataset.cont;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      hdr.querySelector('.lv-chev').textContent = isOpen ? '▸' : '▾';
      openState.band[cont] = !isOpen;
    });
  });
  el.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const e = cache[row.dataset.id];
      if (e?.feature) openDrilldown(e.feature);
    });
  });
}

// ─── By Region ───────────────────────────────────────────────────────────────
export function updateByRegion() {
  const el = document.getElementById('screen-by-region');
  if (!el) return;
  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;

  if (!state.scoreCacheBuilt || !Object.keys(cache).length) {
    el.innerHTML = '<div class="lv-empty">⏳ Laden…</div>'; return;
  }

  const selected = state.selectedContinent;

  if (!selected) {
    // Continent overzicht
    const cd = {};
    for (const entry of Object.values(cache)) {
      const cont = entry.continent ?? 'EU';
      if (!cd[cont]) cd[cont] = { best: 0, bestBand: '—', count: 0 };
      for (const [b, s] of Object.entries(entry.steps?.[step] ?? {})) {
        if (s > cd[cont].best) { cd[cont].best = s; cd[cont].bestBand = b; }
      }
      cd[cont].count++;
    }
    const sorted = CONT_ORDER.filter(c => cd[c])
      .concat(Object.keys(cd).filter(c => !CONT_ORDER.includes(c)))
      .sort((a, b) => cd[b].best - cd[a].best);

    let html = '<div class="lv-top"><span class="lv-sum">Kies een continent ▸</span></div><div class="lv-scroll">';
    for (const cont of sorted) {
      const d = cd[cont];
      const info = CONT[cont] ?? { name: cont, flag: '🌐' };
      html += `
      <div class="lv-cont-row" data-cont="${cont}">
        <span class="lv-flag">${info.flag}</span>
        <span class="lv-cname">${info.name}</span>
        <span class="lv-chip">${d.bestBand}</span>
        ${bar(d.best)}${pct(d.best)}
        <span class="lv-count">${d.count}</span>
        <span class="lv-chev">▸</span>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll('.lv-cont-row').forEach(row => {
      row.addEventListener('click', () => {
        state.selectedContinent = row.dataset.cont; updateByRegion();
      });
    });
    return;
  }

  // Entiteitlijst
  const info = CONT[selected] ?? { name: selected, flag: '🌐' };
  const rows = Object.entries(cache)
    .filter(([, e]) => (e.continent ?? 'EU') === selected)
    .map(([id, entry]) => {
      const sc   = entry.steps?.[step] ?? {};
      const best = Object.entries(sc).sort((a, b) => b[1]-a[1])[0];
      return { id, entry, bestBand: best?.[0] ?? '—', bestScore: best?.[1] ?? 0, sc };
    })
    .sort((a, b) => b.bestScore - a.bestScore);

  let html = `
  <div class="lv-top">
    <button class="lv-back" id="lv-back">← Terug</button>
    <span class="lv-ctitle">${info.flag} ${info.name}</span>
  </div>
  <div class="lv-scroll">`;

  for (const { id, entry, bestBand, bestScore, sc } of rows) {
    const bands = ALL_BANDS
      .filter(b => (sc[b] ?? 0) > 0)
      .map(b => `<span class="mb ${tier(sc[b])}" title="${b}:${sc[b]}%">${b}</span>`)
      .join('');
    html += `
    <div class="lv-row" data-id="${id}">
      <span class="lv-pfx">${entry.prefix}</span>
      <span class="lv-nm">${entry.name}</span>
      <div class="lv-bands">${bands}</div>
      <span class="lv-chip">${bestBand}</span>
      ${pct(bestScore)}
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;

  el.querySelector('#lv-back')?.addEventListener('click', () => {
    state.selectedContinent = null; updateByRegion();
  });
  el.querySelectorAll('.lv-row').forEach(row => {
    row.addEventListener('click', () => {
      const e = cache[row.dataset.id];
      if (e?.feature) openDrilldown(e.feature);
    });
  });
}
