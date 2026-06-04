/**
 * listview.js — By Band + By Region
 * Inklapbare continent-groepen met een responsief TEGELRASTER:
 * elke tegel toont landvlag, landnaam, prefix en score. Klikbaar → drilldown.
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

// ISO 3166-1 numeriek → alpha-2 (alleen de codes die in de DXCC-set voorkomen)
const ISO_NUM_A2 = {
  4:'AF',12:'DZ',31:'AZ',32:'AR',36:'AU',40:'AT',50:'BD',51:'AM',56:'BE',64:'BT',
  68:'BO',70:'BA',72:'BW',76:'BR',100:'BG',104:'MM',108:'BI',112:'BY',116:'KH',120:'CM',
  124:'CA',144:'LK',152:'CL',156:'CN',170:'CO',180:'CD',188:'CR',191:'HR',192:'CU',196:'CY',
  203:'CZ',208:'DK',214:'DO',218:'EC',231:'ET',233:'EE',246:'FI',250:'FR',266:'GA',268:'GE',
  276:'DE',288:'GH',300:'GR',328:'GY',332:'HT',348:'HU',352:'IS',356:'IN',360:'ID',364:'IR',
  368:'IQ',372:'IE',376:'IL',380:'IT',384:'CI',388:'JM',392:'JP',398:'KZ',400:'JO',404:'KE',
  408:'KP',410:'KR',414:'KW',417:'KG',418:'LA',422:'LB',428:'LV',434:'LY',440:'LT',442:'LU',
  454:'MW',458:'MY',484:'MX',496:'MN',498:'MD',499:'ME',504:'MA',508:'MZ',512:'OM',516:'NA',
  524:'NP',528:'NL',554:'NZ',566:'NG',578:'NO',586:'PK',591:'PA',598:'PG',600:'PY',604:'PE',
  608:'PH',616:'PL',620:'PT',634:'QA',642:'RO',643:'RU',646:'RW',682:'SA',686:'SN',688:'RS',
  703:'SK',704:'VN',705:'SI',706:'SO',710:'ZA',716:'ZW',724:'ES',729:'SD',740:'SR',752:'SE',
  756:'CH',760:'SY',762:'TJ',764:'TH',784:'AE',788:'TN',792:'TR',795:'TM',800:'UG',804:'UA',
  807:'MK',818:'EG',826:'GB',834:'TZ',840:'US',858:'UY',860:'UZ',862:'VE',887:'YE',894:'ZM',
};

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

// iso_num → vlag-emoji (regional indicator symbols). Fallback: globe.
function flagFor(entry) {
  const iso = entry?.feature?.properties?.iso_num;
  const a2  = ISO_NUM_A2[iso];
  if (!a2) return '🌐';
  return String.fromCodePoint(...[...a2].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// Eén land-tegel
function tile(id, entry, score, sub) {
  return `
    <button class="lv-tile ${tier(score)}" data-id="${id}">
      <span class="lv-tflag">${flagFor(entry)}</span>
      <span class="lv-tname" title="${entry.name}">${entry.name}</span>
      <span class="lv-tmeta"><span class="lv-tpfx">${entry.prefix}</span>${sub ? `<span class="lv-tsub">${sub}</span>` : ''}</span>
      <span class="lv-tscore ${tier(score)}">${score}%</span>
      ${bar(score)}
    </button>`;
}

export function updateListview() { updateByBand(); updateByRegion(); }

// ─── By Band ─────────────────────────────────────────────────────────────────
export function updateByBand() {
  const el = document.getElementById('screen-by-band');
  if (!el) return;
  const cache = state.scoreCache;
  const step  = state.activeTimeOffset;
  const band  = state.activeBand;
  const thr   = state.user.thresholdPct ?? 60;

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
      <div class="lv-gbody"${isOpen ? '' : ' style="display:none"'}>
        <div class="lv-grid">`;

    for (const { id, entry, score } of rows) {
      const hide = (filterOpen && score < thr) ? ' lv-hide' : '';
      html += tile(id, entry, score).replace('class="lv-tile', `class="lv-tile${hide}`);
    }
    html += '</div></div></div>';
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
  el.querySelectorAll('.lv-tile').forEach(tileEl => {
    tileEl.addEventListener('click', () => {
      const e = cache[tileEl.dataset.id];
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
    // Continent overzicht (korte lijst — blijft rijen)
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

  // Entiteit-tegels voor het gekozen continent
  const info = CONT[selected] ?? { name: selected, flag: '🌐' };
  const rows = Object.entries(cache)
    .filter(([, e]) => (e.continent ?? 'EU') === selected)
    .map(([id, entry]) => {
      const sc   = entry.steps?.[step] ?? {};
      const best = Object.entries(sc).sort((a, b) => b[1]-a[1])[0];
      return { id, entry, bestBand: best?.[0] ?? '—', bestScore: best?.[1] ?? 0 };
    })
    .sort((a, b) => b.bestScore - a.bestScore);

  let html = `
  <div class="lv-top">
    <button class="lv-back" id="lv-back">← Terug</button>
    <span class="lv-ctitle">${info.flag} ${info.name}</span>
  </div>
  <div class="lv-scroll">
    <div class="lv-grid">`;

  for (const { id, entry, bestBand, bestScore } of rows) {
    html += tile(id, entry, bestScore, bestBand);
  }
  html += '</div></div>';
  el.innerHTML = html;

  el.querySelector('#lv-back')?.addEventListener('click', () => {
    state.selectedContinent = null; updateByRegion();
  });
  el.querySelectorAll('.lv-tile').forEach(tileEl => {
    tileEl.addEventListener('click', () => {
      const e = cache[tileEl.dataset.id];
      if (e?.feature) openDrilldown(e.feature);
    });
  });
}
