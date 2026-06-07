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
 * Returns status and short-circuit score if applicable.
 *
 * @param {number} bandFreqMHz - band centre frequency
 * @param {number} muf         - estimated MUF in MHz
 * @returns {{ status: string, score: number|null }}
 *   score is 0 (closed), 15 (marginal), or null (continue pipeline)
 */
export function bandStatus(bandFreqMHz, muf) {
  const ratio = bandFreqMHz / muf;
  if (ratio > 1.10) return { status: 'closed',    score: 0  };
  if (ratio > 0.95) return { status: 'marginal',  score: 15 };
  if (ratio > 0.80) return { status: 'good',      score: null };
  return               { status: 'suboptimal',  score: null }; // D-layer dominant
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
  'FT8':    28,
  'FT4':    26,
  'JT65':   30,
  'CW':     20,
  'SSB':    16,  // was 6 → 25W SSB factor ~0.62
  'AM':     10,
  'MSK144': 20,
  'default':16,
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
  const margin = MODE_MARGINS[mode] ?? MODE_MARGINS['default'];
  return Math.max(0.40, Math.min(1.15, 1 + (dBdiff / margin)));
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
 * Each hop beyond the first adds dB loss.
 *
 * @param {string} band       - e.g. '40m'
 * @param {number} distanceKm
 * @returns {number} linear factor 0–1
 */
export function multiHopFactor(band, distanceKm) {
  const hops = numHops(distanceKm);
  if (hops <= 1) return 1.0;
  const lossPerHop = HOP_LOSS_DB[band] ?? 3;
  const totalLoss = lossPerHop * (hops - 1);
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

/** Maximum Es probability per band */
const ES_BANDS = {
  '6m':  0.40,
  '10m': 0.25,
  '12m': 0.10,
  '15m': 0.05,
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
 * @returns {number} additive bonus (0–0.40)
 */
export function esBonus(band, month, distanceKm, lat) {
  const basePct = ES_BANDS[band];
  if (!basePct) return 0;

  // Distance gate: Es paths are typically 800–2500 km
  if (distanceKm < 800 || distanceKm > 2600) return 0;

  const isNHPeak = lat >= 0 && ES_NH_MONTHS.has(month);
  const isSHPeak = lat <  0 && ES_SH_MONTHS.has(month);
  const seasonFactor = (isNHPeak || isSHPeak) ? 1.0 : 0.2;

  return basePct * seasonFactor;
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

  // Step 2 — Solar elevations
  let elevTx = 0, elevRx = 0;
  if (typeof SunCalc !== 'undefined') {
    elevTx = SunCalc.getPosition(time, txLat, txLon).altitude * (180 / Math.PI);
    elevRx = SunCalc.getPosition(time, rxLat, rxLon).altitude * (180 / Math.PI);
  }

  // Step 3 — MUF gate
  const muf  = estimateMUF(sfi, distKm, Math.max(elevTx, elevRx));
  const gate = bandStatus(bandFreq, muf);

  if (gate.score === 0) {
    return {
      score: 0, score100W: 0,
      details: { distKm, muf, elevTx, elevRx, isTxGL: false, isRxGL: false, status: 'closed', reason: 'above_muf', hops: numHops(distKm) },
    };
  }

  // Step 4 — Base reliability
  let rel = gate.score !== null
    ? gate.score / 100           // marginal gate (15% ceiling)
    : sfiBaseReliability(sfi);   // continue with SFI base

  // Step 5 — Kp degradation
  rel *= kpFactor(band, kp);

  // Step 6 — D-layer absorption
  rel *= bandAbsorptionPenalty(band, elevTx, elevRx);

  // Step 7 — Greyline bonus
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
  rel = Math.min(0.99, rel + greylineBonus(band, isTxGL, isRxGL));

  // Step 8 — F2 gradient (long paths only — NEVER < 1500 km)
  rel = applyF2Gradient(rel, distKm, sfi, elevTx);

  // Step 9 — Multi-hop attenuation
  rel *= multiHopFactor(band, distKm);

  // Step 10 — Sporadic-E bonus
  const month = time.getUTCMonth() + 1; // 1–12
  rel = Math.min(0.99, rel + esBonus(band, month, distKm, txLat));

  // Step 11 — Clamp to 0–99% for 100W reference
  const score100W = Math.round(Math.max(0, Math.min(99, rel * 100)));

  // Step 12 — Power correction
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
