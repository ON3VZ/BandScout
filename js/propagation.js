/**
 * HF Band Scout — Propagation Engine
 *
 * Pure RF calculation functions. No DOM access. No imports from
 * other app modules. SunCalc is a global from lib/suncalc.js.
 *
 * Formulas sourced from:
 *   - NOAA Space Weather Scales
 *   - RSGB Propagation Studies Committee
 *   - IPS Radio and Space Services (Australia)
 *   - VOACAP (reference for MUF validation)
 *   - Propagation Watch (ON3VZ/JO20ev) validated engine
 *
 * All functions are unit-testable: paste into browser console
 * and call with sample params.
 *
 * KNOWN LIMITATIONS (see README):
 *   - MUF model is empirical approximation, not VOACAP
 *   - Kp matrix is a starting approximation, not measured data
 *   - No terrain model
 *   - VHF/UHF is LoS/tropo only (see vhfTropoScore)
 *   - Sporadic-E is probabilistic, not real-time
 */

// ─────────────────────────────────────────────
// 1. Band definitions
// ─────────────────────────────────────────────

/** Band centre frequencies in MHz */
const BAND_FREQ = {
  '160m': 1.850,
  '80m':  3.700,
  '40m':  7.100,
  '30m':  10.125,
  '20m':  14.175,
  '17m':  18.118,
  '15m':  21.200,
  '12m':  24.940,
  '10m':  28.500,
  '6m':   51.000,
};

// ─────────────────────────────────────────────
// 2. Solar elevation and D-layer
// ─────────────────────────────────────────────

/**
 * D-layer absorption factor.
 * Returns 0 at night, approaching 1 at solar noon.
 * Sigmoid centred at 0° elevation, width ~20°.
 *
 * @param {number} elevationDeg - solar elevation in degrees
 * @returns {number} 0–1
 */
export function dLayerFactor(elevationDeg) {
  return Math.max(0, Math.min(1, 1 / (1 + Math.exp(-0.15 * elevationDeg))));
}

/** D-layer absorption coefficients per band */
const D_LAYER_COEFF = {
  '160m': 0.90,
  '80m':  0.70,  // was 0.85
  '40m':  0.50,  // was 0.65 → 40m dag niet meer donker rood
  '30m':  0.35,
  '20m':  0.15,
  '17m':  0.05,
  '15m':  0.04,
  '12m':  0.03,
  '10m':  0.01,
  '6m':   0.005,
};

/**
 * Band absorption penalty factor (0–1).
 * Uses worst-case endpoint (higher absorption if either end in daylight).
 *
 * @param {string} band    - e.g. '40m'
 * @param {number} elevTx  - solar elevation at TX (degrees)
 * @param {number} elevRx  - solar elevation at RX (degrees)
 * @returns {number} multiplier 0–1 (1 = no absorption, 0 = total)
 */
export function bandAbsorptionPenalty(band, elevTx, elevRx) {
  const coeff = D_LAYER_COEFF[band] ?? 0.02;
  const dTx = dLayerFactor(elevTx);
  const dRx = dLayerFactor(elevRx);
  return 1 - coeff * Math.max(dTx, dRx);
}

// ────────────────────────────────────────────
// 3. MUF model
// ─────────────────────────────────────────────

/**
 * Estimate Maximum Usable Frequency for a path.
 * Formula: (SFI × 0.12 + 2) × distanceFactor
 *
 * @param {number} sfi        - Solar Flux Index (70–300 typical)
 * @param {number} distanceKm - great-circle path distance
 * @param {number} solarElevDeg - zonshoogte (°), drijft dag/nacht-MUF
 * @returns {number} estimated MUF in MHz
 */
export function estimateMUF(sfi, distanceKm, solarElevDeg = 90) {
  // Kritische frequentie (verticale inval), SFI-afhankelijk, met dag/nacht-schaling.
  // Lost het korte-pad-probleem op: korte paden hielden vroeger MUF ~0 over
  // (distanceKm/4000), waardoor heel Europa "boven MUF" = gesloten = grijs werd.
  const foF2base = 2 + sfi * 0.08;                                  // ~13.5 MHz @ SFI 144 (dagpiek)
  const dayScale = 0.5 + 0.5 * Math.max(0, Math.min(1, solarElevDeg / 40));
  const foF2     = foF2base * dayScale;                             // nacht ~0.5x, zon hoog = vol
  // Obliciteitsfactor: verticaal (~1) tot ~3.4 bij enkel-/multi-hop >= 3000 km.
  const obliquity = 1 + 2.4 * Math.min(1, distanceKm / 3000);
  return foF2 * obliquity;
}

/**
 * Band gating against MUF.
 * Returns status label and short-circuit score if applicable.
 * FASE 3 (B2/B3): de harde gates (0 / vaste 15) zijn vervangen door een
 * continue taper — zie mufFactor(). Deze functie levert nu alleen nog het
 * statuslabel; 'closed' begint pas bij ratio > 1.25 (waar de taper 0 raakt).
 *
 * @param {number} bandFreqMHz - band centre frequency
 * @param {number} muf         - estimated MUF in MHz
 * @returns {{ status: string, score: number|null }}
 */
export function bandStatus(bandFreqMHz, muf) {
  const ratio = bandFreqMHz / muf;
  if (ratio > 1.30) return { status: 'closed',    score: 0   };
  if (ratio > 0.95) return { status: 'marginal',  score: null };
  if (ratio > 0.80) return { status: 'good',      score: null };
  return               { status: 'suboptimal',  score: null }; // D-layer dominant
}

/**
 * Continue MUF-waarschijnlijkheidsfactor (FASE 3, B2/B3).
 * Echte propagatie heeft een kansverdeling rond de MUF; de oude binaire
 * gates (open → 15% → 0%) gaven harde "cliffs" tussen buurlanden op de
 * kaart (bv. DL 15m = 8 naast EA 15m = 76). Cosinus-taper van 1.0 bij
 * ratio ≤ 0.95 naar 0 bij ratio ≥ 1.25. Dit vervangt ook de oude
 * "marginal = 15"-basis (B3): de taper is nu het natuurlijke plafond en
 * wordt niet meer dubbel gestraft door een vaste lage basis.
 *
 * @param {number} bandFreqMHz
 * @param {number} muf
 * @returns {number} factor 0–1
 */
export function mufFactor(bandFreqMHz, muf) {
  // Verankerd op de klassieke definities:
  //   FOT ≈ 0.85 × MUF → ~100% kans
  //   MUF zelf         → 50% kans (per definitie: mediaan)
  //   HPF-zone         → uitlopend naar 0 bij ratio 1.30
  const ratio = bandFreqMHz / muf;
  if (ratio <= 0.85) return 1.0;
  if (ratio >= 1.30) return 0.0;
  if (ratio < 1.0) {
    // 0.85 → 1.0 : 1.0 → 0.5 (cosinussegment)
    return 0.75 + 0.25 * Math.cos(Math.PI * (ratio - 0.85) / 0.15);
  }
  // 1.0 → 1.30 : 0.5 → 0 (cosinussegment)
  return 0.25 + 0.25 * Math.cos(Math.PI * (ratio - 1.0) / 0.30);
}

// ─────────────────────────────────────────────
// 4. Base reliability from SFI
// ────────────────────────────────────────────

/**
 * SFI → base reliability (0–1).
 * SFI 70 = floor (solar minimum), SFI 150+ = excellent.
 *
 * @param {number} sfi
 * @returns {number} 0.05–1.0
 */
export function sfiBaseReliability(sfi) {
  return Math.min(1, Math.max(0.05, sfi / 150));
}

// ─────────────────────────────────────────────
// 5. Kp degradation matrix
// ─────────────────────────────────────────────

/**
 * Band-specific Kp degradation factors.
 * Index = floor(Kp), values 0–9.
 * Low bands are hit harder (polar path dependency).
 */
const KP_MATRIX = {
  '160m': [1.00,0.90,0.75,0.50,0.25,0.10,0.00,0.00,0.00,0.00],
  '80m':  [1.00,0.90,0.80,0.60,0.35,0.15,0.05,0.00,0.00,0.00],
  '40m':  [1.00,0.95,0.85,0.70,0.50,0.25,0.10,0.05,0.00,0.00],
  '30m':  [1.00,0.98,0.90,0.80,0.60,0.35,0.15,0.05,0.00,0.00],
  '20m':  [1.00,1.00,0.95,0.85,0.65,0.40,0.20,0.05,0.00,0.00],
  '17m':  [1.00,1.00,0.97,0.88,0.70,0.45,0.25,0.10,0.02,0.00],
  '15m':  [1.00,1.00,0.98,0.90,0.75,0.50,0.30,0.12,0.03,0.00],
  '12m':  [1.00,1.00,0.99,0.92,0.78,0.55,0.33,0.15,0.05,0.00],
  '10m':  [1.00,1.00,1.00,0.95,0.82,0.60,0.38,0.18,0.06,0.01],
  '6m':   [1.00,1.00,1.00,0.97,0.88,0.70,0.50,0.30,0.12,0.04],
};

/**
 * Kp degradation multiplier for a band at a given Kp index.
 *
 * @param {string} band  - e.g. '20m'
 * @param {number} kp    - Kp index (0–9)
 * @returns {number} multiplier 0–1
 */
export function kpFactor(band, kp) {
  const row = KP_MATRIX[band] ?? KP_MATRIX['20m'];
  const idx = Math.min(9, Math.max(0, Math.floor(kp)));
  return row[idx];
}

// ─────────────────────────────────────────────
// 6. Greyline bonus
// ─────────────────────────────────────────────

/** Maximum greyline bonus per band (applied when both ends in greyline window) */
const GREYLINE_BONUS_MAX = {
  '80m':  0.30,
  '40m':  0.25,
  '30m':  0.20,
  '20m':  0.10,
  '160m': 0.15,
  // Higher bands: negligible effect
};

/**
 * Greyline bonus additive factor.
 * Full bonus when both endpoints are in greyline window (±20 min sunrise/sunset).
 * Partial (40%) when only one end is in greyline.
 *
 * @param {string}  band    - e.g. '40m'
 * @param {boolean} isTxGL  - TX end in greyline?
 * @param {boolean} isRxGL  - RX end in greyline?
 * @returns {number} bonus to add to reliability (0–0.30)
 */
export function greylineBonus(band, isTxGL, isRxGL) {
  if (!isTxGL && !isRxGL) return 0;
  const maxBonus = GREYLINE_BONUS_MAX[band] ?? 0.05;
  if (isTxGL && isRxGL) return maxBonus;
  return maxBonus * 0.4; // one end only
}

// ─────────────────────────────────────────────
// 7. Power correction (mode-aware)
// ─────────────────────────────────────────────

/** Reference power for 100% factor */
const REFERENCE_POWER_W = 100;

/**
 * SNR margins (dB) per mode at 100W on a good path.
 * Larger margin = more tolerant of low power.
 */
const MODE_MARGINS = {
  'FT8':    44,
  'FT4':    40,
  'JT65':   48,
  'CW':     36,
  'SSB':    30,   // 25W SSB factor ~0.80 — 25W werkt in praktijk
  'AM':     22,
  'MSK144': 36,
  'default':32,
};

/**
 * Power correction factor relative to 100W reference.
 * Values > 1.0 for power > 100W, < 1.0 for QRP.
 * Capped at 1.3 (diminishing returns above 100W).
 *
 * @param {number} txPowerW - transmit power in watts
 * @param {string} mode     - e.g. 'FT8', 'CW', 'SSB'
 * @returns {number} factor (0.05–1.3)
 */
export function powerFactor(txPowerW, mode) {
  const dBdiff = 10 * Math.log10(txPowerW / REFERENCE_POWER_W);
  // FIX A1: settings.js slaat mode lowercase op ('ssb'); keys zijn uppercase.
  // Zonder normalisatie viel ELKE mode terug op 'default' (marge 32).
  const margin = MODE_MARGINS[String(mode ?? '').toUpperCase()] ?? MODE_MARGINS['default'];
  // FASE 4 — kalibratie: floor 0.60/cap 1.15 maakte de vermogensinstelling
  // bijna cosmetisch (1W SSB kreeg nog 60%, 1.5kW maar +15%). Nu floor 0.25,
  // cap 1.25. Het 25W-anker blijft EXACT gelijk (SSB 0.80 / CW 0.83 /
  // FT8 0.86); alleen de uiteinden veranderen: 1W SSB → 0.33 (terecht zwaar),
  // 1W FT8 → 0.55 (QRP-digitaal werkt), QRO → tot +25%.
  return Math.max(0.25, Math.min(1.25, 1 + (dBdiff / margin)));
}

// ─────────────────────────────────────────────
// 8. Distance and multi-hop attenuation
// ─────────────────────────────────────────────

/** F2 gradient only applies to paths longer than this */
const F2_GRADIENT_MIN_KM = 1500;

/** Loss per additional ionospheric hop (dB) */
const HOP_LOSS_DB = {
  '160m': 8, '80m': 6, '40m': 5, '30m': 4,
  '20m': 3, '17m': 3, '15m': 2.5, '12m': 2, '10m': 2, '6m': 2,
};

/**
 * Estimated number of ionospheric hops for a path.
 * Each hop ≈ 3500 km.
 *
 * @param {number} distanceKm
 * @returns {number} integer ≥ 1
 */
export function numHops(distanceKm) {
  return Math.ceil(distanceKm / 3500);
}

/**
 * Multi-hop attenuation factor.
 * FASE 3 (B1): fractionele hops i.p.v. ceil() — de oude trapfunctie gaf
 * harde sprongen op hopgrenzen (3400 km factor 1.00 → 3600 km factor 0.71)
 * die op de kaart als concentrische kleurringen zichtbaar waren.
 *
 * @param {string} band       - e.g. '40m'
 * @param {number} distanceKm
 * @returns {number} linear factor 0–1
 */
export function multiHopFactor(band, distanceKm) {
  const hopsF = distanceKm / 3500;          // fractioneel aantal hops
  if (hopsF <= 1) return 1.0;
  const lossPerHop = HOP_LOSS_DB[band] ?? 3;
  const totalLoss = lossPerHop * (hopsF - 1); // vloeiend vanaf 3500 km
  return Math.pow(10, -totalLoss / 20);
}

/**
 * F2 gradient correction for long paths (> 1500 km only).
 * Slight improvement when TX is in daylight (higher F2 ionisation).
 * RULE: never applied to short paths (< 1500 km) — see architecture doc.
 *
 * @param {number} reliability - current reliability estimate (0–1)
 * @param {number} distanceKm
 * @param {number} sfi
 * @param {number} solarElevTx - solar elevation at TX (degrees)
 * @returns {number} adjusted reliability
 */
export function applyF2Gradient(reliability, distanceKm, sfi, solarElevTx) {
  if (distanceKm < F2_GRADIENT_MIN_KM) return reliability; // gate — never skip this
  const dayBonus = Math.max(0, solarElevTx / 90) * 0.08;
  return Math.min(0.99, reliability + dayBonus);
}

// ─────────────────────────────────────────────
// 9. Sporadic-E model
// ─────────────────────────────────────────────

/**
 * Maximum Es probability per band — Es-v2.
 * P(Es-MUF > f) daalt monotoon met frequentie. De oude tabel ('6m' hoogst,
 * 20m/17m ontbraken) codeerde "relevantie", niet kans — waardoor intra-EU
 * 20m in het Es-seizoen donkerrood kleurde terwijl WSPR duizenden echte
 * spots op 500–2000 km toonde.
 */
const ES_BANDS = {
  '20m': 0.40,
  '17m': 0.35,
  '15m': 0.30,
  '12m': 0.25,
  '10m': 0.22,
  '6m':  0.12,
};

/** NH peak months (May, June, July) */
const ES_NH_MONTHS = new Set([5, 6, 7]);
/** SH peak months (Nov, Dec, Jan) */
const ES_SH_MONTHS = new Set([11, 12, 1]);

/**
 * Sporadic-E probability bonus.
 * Probabilistic estimate — elevated in summer at mid-latitudes.
 * NOT real-time detection.
 *
 * @param {string} band       - band name
 * @param {number} month      - UTC month (1–12)
 * @param {number} distanceKm - great-circle distance
 * @param {number} lat        - TX latitude (for NH/SH determination)
 * @param {number} [localHour=15] - lokale zonnetijd op het padmidden (0–24)
 * @returns {number} additive bonus (0–0.40)
 */
export function esBonus(band, month, distanceKm, lat, localHour = 15) {
  const basePct = ES_BANDS[band];
  if (!basePct) return 0;

  // Distance gate: single-hop Es draagt ~600–2600 km (WSPR-data toont de
  // grootste spotdichtheid in de 500–1000 km-bucket)
  if (distanceKm < 600 || distanceKm > 2600) return 0;

  const isNHPeak = lat >= 0 && ES_NH_MONTHS.has(month);
  const isSHPeak = lat <  0 && ES_SH_MONTHS.has(month);
  const seasonFactor = (isNHPeak || isSHPeak) ? 1.0 : 0.2;

  // Es-v2: DUBBELE dagpiek — klassiek rond ~11:00 en ~19:00 lokale
  // zonnetijd (padmidden), met een lichte middagdip en een lage maar niet
  // nul nachtbodem. De oude enkele piek om 15:00 doofde de werkelijke
  // avond-Es (die WSPR live laat zien) veel te hard uit.
  const bump = (peak) => Math.max(0, Math.cos((localHour - peak) * Math.PI / 10));
  const diurnal = 0.25 + 0.75 * Math.max(bump(11), bump(19));

  return basePct * seasonFactor * diurnal;
}

// ─────────────────────────────────────────────
// 10. VHF/UHF (non-ionospheric model)
// ────────────────────────────────────────────

/**
 * Radio horizon distance estimate (simplified, no terrain).
 * d = 4.12 × (√htx + √hrx) in km
 *
 * @param {number} [txHeightM=10]
 * @param {number} [rxHeightM=10]
 * @returns {number} km
 */
export function radioHorizonKm(txHeightM = 10, rxHeightM = 10) {
  return 4.12 * (Math.sqrt(txHeightM) + Math.sqrt(rxHeightM));
}

/**
 * VHF/UHF tropo score (line-of-sight / troposcatter model only).
 * EME and meteor scatter not modelled.
 *
 * @param {number} distKm
 * @param {number} [txHeightM=10]
 * @returns {number} score 0–90
 */
export function vhfTropoScore(distKm, txHeightM = 10) {
  const horizon = radioHorizonKm(txHeightM);
  if (distKm <= horizon)        return 90;
  if (distKm <= horizon * 2)    return 50;
  if (distKm <= horizon * 4)    return 15;
  return 0;
}

// ────────────────────────────────────────────
// 11. Master reliability pipeline
// ─────────────────────────────────────────────

/**
 * Calculate propagation reliability for one band to one target.
 * Returns both the power-corrected score and the 100W reference score.
 *
 * This is the single entry point for all scoring. It is pure and
 * side-effect-free — safe to call millions of times during cache build.
 *
 * @param {Object} params
 * @param {string} params.band       - e.g. '20m'
 * @param {number} params.txLat      - TX latitude
 * @param {number} params.txLon      - TX longitude
 * @param {number} params.rxLat      - RX latitude (DXCC centroid)
 * @param {number} params.rxLon      - RX longitude
 * @param {Date}   params.time       - UTC time to evaluate
 * @param {number} params.sfi        - Solar Flux Index
 * @param {number} params.kp         - Kp index (0–9)
 * @param {number} params.txPowerW   - TX power in watts
 * @param {string} params.mode       - e.g. 'FT8', 'CW', 'SSB'
 * @param {number} [params.distKm]   - pre-computed distance (optional, for perf)
 *
 * @returns {{
 *   score: number,       // 0–99, power-corrected
 *   score100W: number,   // 0–99, 100W reference
 *   details: {
 *     distKm: number,
 *     muf: number,
 *     elevTx: number,
 *     elevRx: number,
 *     isTxGL: boolean,
 *     isRxGL: boolean,
 *     status: string,
 *     hops: number,
 *     reason?: string,
 *   }
 * }}
 */
export function calcReliability(params) {
  const {
    band, txLat, txLon, rxLat, rxLon, time,
    sfi, kp, txPowerW, mode,
  } = params;

  // ── VHF/UHF: use separate model ──
  if (band === '2m' || band === '70cm') {
    const distKm = params.distKm ?? haversineKmInternal(txLat, txLon, rxLat, rxLon);
    const s = vhfTropoScore(distKm);
    return {
      score: s,
      score100W: s,
      details: { distKm, muf: 0, elevTx: 0, elevRx: 0, isTxGL: false, isRxGL: false, status: 'vhf', hops: 1 },
    };
  }

  const bandFreq = BAND_FREQ[band];
  if (!bandFreq) {
    return { score: 0, score100W: 0, details: { reason: 'unknown_band' } };
  }

  // Step 1 — Distance
  const distKm = params.distKm ?? haversineKmInternal(txLat, txLon, rxLat, rxLon);

  // Step 2 — Solar elevations (eindpunten + pad-controlepunten)
  // FIX A3 (fase 2): MUF en D-laag werden op de EINDPUNTEN geëvalueerd, met
  // max(elevTx, elevRx) als dagproxy. Gevolg: een 9300 km pad naar JA om
  // 00:00 UTC kreeg dag-MUF omdat de zon in Tokio op was, terwijl het pad
  // grotendeels door de nacht loopt. Nu: controlepunten langs de great
  // circle; de F2-MUF wordt gegated door het ZWAKSTE segment (min-elevatie),
  // D-laagabsorptie door het sterkst belichte punt (max-elevatie).
  let elevTx = 0, elevRx = 0;
  let pathElevs = [0];
  if (typeof SunCalc !== 'undefined') {
    const elevAt = (la, lo) =>
      SunCalc.getPosition(time, la, lo).altitude * (180 / Math.PI);
    elevTx = elevAt(txLat, txLon);
    elevRx = elevAt(rxLat, rxLon);
    pathElevs = [elevTx, elevRx];
    if (distKm >= 2000) {
      // Controlepunten op ~1500 km van elk eind + het padmidden
      const fEdge = Math.min(0.45, 1500 / distKm);
      for (const f of [fEdge, 0.5, 1 - fEdge]) {
        const p = greatCirclePoint(txLat, txLon, rxLat, rxLon, f);
        pathElevs.push(elevAt(p.lat, p.lon));
      }
    } else if (distKm >= 500) {
      const mid = greatCirclePoint(txLat, txLon, rxLat, rxLon, 0.5);
      pathElevs.push(elevAt(mid.lat, mid.lon));
    }
  }
  const minPathElev = Math.min(...pathElevs);
  const maxPathElev = Math.max(...pathElevs);

  // Step 3 — MUF gate (zwakste segment bepaalt de F2-reflectie)
  const muf  = estimateMUF(sfi, distKm, minPathElev);
  const gate = bandStatus(bandFreq, muf);

  // Lokale zonnetijd op het padmidden (voor Es-dagfactor, fase 3)
  const midLon = greatCirclePoint(txLat, txLon, rxLat, rxLon, 0.5).lon;
  const localHourMid = ((time.getUTCHours() + time.getUTCMinutes() / 60) + midLon / 15 + 24) % 24;

  if (gate.status === 'closed') {
    // Skip-zone: korte paden boven MUF kunnen nog via backscatter/grondgolf/NVIS
    const szFloor = distKm < 1200 ? 8 : 0;
    // FIX A2: Sporadic-E is precies het mechanisme dat 10m/6m opent als de
    // F2-MUF te laag is. De Es-bonus mag dus NIET door de MUF-gate worden
    // geblokkeerd. Es-kans (0–0.40) wordt hier als zelfstandige score gebruikt.
    const month = time.getUTCMonth() + 1;
    const esB   = esBonus(band, month, distKm, txLat, localHourMid);
    const base  = Math.max(szFloor, Math.round(esB * 100));
    const pf    = powerFactor(txPowerW, mode);
    return {
      score:     Math.round(Math.max(0, Math.min(99, base * pf))),
      score100W: base,
      details: {
        distKm, muf, elevTx, elevRx, isTxGL: false, isRxGL: false,
        status: esB > 0 ? 'sporadic-e' : (szFloor > 0 ? 'skip-zone' : 'closed'),
        reason: 'above_muf', hops: numHops(distKm),
      },
    };
  }

  // Step 4 — Base reliability × continue MUF-taper (fase 3, B2/B3)
  // De taper vervangt de oude "marginal = vaste 15%"-basis die daarna nog
  // door Kp/absorptie/multihop/power werd vermenigvuldigd (dubbele straf).
  let rel = sfiBaseReliability(sfi) * mufFactor(bandFreq, muf);

  // Step 5 — Kp degradation
  rel *= kpFactor(band, kp);

  // Step 6 — D-layer absorption (sterkst belichte punt op het pad — fix A3)
  rel *= bandAbsorptionPenalty(band, maxPathElev, maxPathElev);

  // Step 7 — Greyline detection (bonus wordt pas NA multihop opgeteld — fix A4)
  let isTxGL = false, isRxGL = false;
  if (typeof SunCalc !== 'undefined') {
    const WINDOW_MS = 20 * 60 * 1000;
    const times = SunCalc.getTimes(time, txLat, txLon);
    const timesRx = SunCalc.getTimes(time, rxLat, rxLon);
    const now = time.getTime();
    const glCheck = (t) => t instanceof Date && !isNaN(t) && Math.abs(now - t.getTime()) <= WINDOW_MS;
    isTxGL = glCheck(times.sunrise) || glCheck(times.sunset);
    isRxGL = glCheck(timesRx.sunrise) || glCheck(timesRx.sunset);
  }

  // Step 8 — F2 gradient (long paths only — NEVER < 1500 km)
  rel = applyF2Gradient(rel, distKm, sfi, elevTx);

  // Step 9 — Multi-hop attenuation
  rel *= multiHopFactor(band, distKm);

  // Step 10 — Greyline bonus (additief, NA multihop)
  // FIX A4: voorheen werd de bonus vóór multiHopFactor opgeteld en daardoor
  // op lange paden (bv. 80m naar VK, factor 0.06) weggevermenigvuldigd —
  // exact het scenario waarvoor greyline-DX bestaat. Nu blijft de volle
  // bonus overeind op lange-pad greyline-DX.
  rel = Math.min(0.99, rel + greylineBonus(band, isTxGL, isRxGL));

  // Step 11 — Sporadic-E (probabilistische OR met het F2-pad, Es-v2)
  // P(verbinding) = 1 − (1−P_F2)(1−P_Es): Es en F2 zijn onafhankelijke
  // mechanismen. Additief stapelen telde dubbel bij goede F2-condities.
  const month = time.getUTCMonth() + 1; // 1–12
  const esB = esBonus(band, month, distKm, txLat, localHourMid);
  rel = Math.min(0.99, rel + esB - rel * esB);

  // Step 12 — Clamp to 0–99% for 100W reference
  const score100W = Math.round(Math.max(0, Math.min(99, rel * 100)));

  // Step 13 — Power correction
  const pf = powerFactor(txPowerW, mode);
  const score = Math.round(Math.max(0, Math.min(99, rel * pf * 100)));

  const hops = numHops(distKm);

  return {
    score,
    score100W,
    details: {
      distKm,
      muf: Math.round(muf * 10) / 10,
      elevTx: Math.round(elevTx),
      elevRx: Math.round(elevRx),
      isTxGL,
      isRxGL,
      status: gate.status,
      hops,
    },
  };
}

/**
 * Build a human-readable reasoning string for the drill-down panel.
 *
 * @param {string} band
 * @param {number} score
 * @param {Object} details - from calcReliability
 * @param {number} sfi
 * @param {number} kp
 * @returns {string}
 */
export function buildReasonString(band, score, details, sfi, kp) {
  if (!details) return '';
  const { distKm, muf, elevTx, elevRx, isTxGL, isRxGL, status, hops } = details;

  const parts = [];

  if (status === 'closed')     parts.push(`above MUF (${muf} MHz)`);
  if (status === 'marginal')   parts.push(`near MUF limit (${muf} MHz)`);
  if (status === 'good')       parts.push(`MUF ${muf} MHz ✓`);
  if (status === 'suboptimal') parts.push(`below optimal MUF zone`);

  parts.push(`SFI ${sfi}`);

  if (kp >= 4)      parts.push(`⚡ Kp ${kp} storm`);
  else if (kp >= 3) parts.push(`Kp ${kp}`);

  if (elevTx < -5)  parts.push('D-layer quiet (TX night)');
  else if (elevTx > 30) parts.push('D-layer active (TX day)');

  if (isTxGL && isRxGL) parts.push('🌅 Greyline both ends');
  else if (isTxGL)      parts.push('🌅 Greyline TX');
  else if (isRxGL)      parts.push('🌅 Greyline DX');

  if (hops > 2) parts.push(`${hops} hops`);

  return parts.join(' · ') + ` → ${score}%`;
}

// ─────────────────────────────────────────────
// Internal helper (duplicate of utils to keep propagation.js self-contained)
// ────────────────────────────────────────────

/**
 * Great-circle tussenpunt (spherical interpolation).
 * f = 0 → punt 1, f = 1 → punt 2.
 * @returns {{ lat: number, lon: number }}
 */
export function greatCirclePoint(lat1, lon1, lat2, lon2, f) {
  const toRad = Math.PI / 180, toDeg = 180 / Math.PI;
  const φ1 = lat1 * toRad, λ1 = lon1 * toRad;
  const φ2 = lat2 * toRad, λ2 = lon2 * toRad;
  const Δ = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));
  if (Δ < 1e-9) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1 - f) * Δ) / Math.sin(Δ);
  const B = Math.sin(f * Δ) / Math.sin(Δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
    lon: Math.atan2(y, x) * toDeg,
  };
}

function haversineKmInternal(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
