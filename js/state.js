/**
 * HF Band Scout — Central State
 *
 * All mutable application state lives here.
 * No framework reactivity — modules call explicit render functions
 * after modifying state. No DOM access from this file.
 */

export const state = {

  // ── User config (loaded from localStorage on init) ──
  user: {
    callsign:       '',
    grid:           '',
    lat:            51.18,    // Default: Hoboken, Belgium (ON3VZ QTH)
    lon:            4.35,
    label:          '',
    licenseClass:   'A',      // 'A' | 'B' | 'C'
    txPowerW:       100,
    qrpMode:        false,
    mode:           'FT8',    // FT8 | FT4 | JT65 | CW | SSB | AM | MSK144
    radio:          null,     // key from radio-profiles.json, e.g. 'icom-7300-mk2'
    iauRegion:      1,        // 1 = EU/Africa/ME, 2 = Americas, 3 = Asia-Pacific
    language:       'en',
    theme:          'dark',
    colorBlindMode: false,
    thresholdPct:   40,       // score % below which "not reachable" for opening-soon
    openingSoonHours: 2,      // horizon for opening-soon scan (1 | 2 | 3)
    configured:     false,    // false = show settings on first run
  },

  // ── NOAA data (refreshed on schedule) ──
  noaa: {
    kp:          null,   // number
    sfi:         null,   // number
    kpForecast:  [],     // array of {time, kp} objects
    alerts:      [],     // array of alert strings
    fetchedAt:   null,   // Date.now() timestamp
    stale:       false,  // true if last fetch failed
  },

  // ── Active UI selections ──
  activeScreen:     'map',
  activeBand:       '20m',
  activeTimeOffset: 0,        // in 30-min steps (0 = now, 1 = +30min, ..., 47 = +23.5h)

  // ── Pre-computed 24h score cache ──
  // scoreCache[band][dxcc_id][timeStep] = { score, score100W, details }
  // Bands: '160m','80m','40m','30m','20m','17m','15m','12m','10m','6m'
  // timeStep 0–47 = 0h to 23.5h in 30-min increments
  scoreCache:      {},
  scoreCacheBuilt: false,

  // ── Animation ──
  isPlaying:    false,
  playInterval: null,

  // ── Drill-down ──
  selectedDxcc:    null,   // GeoJSON feature object
  drilldownPath:   'short', // 'short' | 'long'

  // ── Loaded static data ──
  dxccFeatures:  [],    // GeoJSON feature array from dxcc.geojson
  radioProfiles: {},    // from data/radio-profiles.json
  bandPlans:     {},    // from data/band-plans.json

  // ── i18n strings (loaded by i18n.js) ──
  i18n: {},
};

// ── Band definitions ──
// Canonical list, ordered for display
export const ALL_BANDS = ['160m','80m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'];

// Frequencies in MHz for propagation calculations (VHF/UHF handled separately)
export const BAND_FREQ_MHZ = {
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
  // 2m and 70cm use VHF model, not HF propagation
};

// Band access by licence class
export const BAND_ACCESS = {
  // Belgisch/CEPT Klasse C (Novice) — enkel deze banden, max 25W
  'novice_be':  ['80m','40m','30m','20m','15m','10m','2m','70cm'],
  // Andere novice/foundation licenties
  'novice':     ['80m','40m','30m','20m','15m','10m','2m','70cm'],
  'technician': ['80m','40m','30m','20m','15m','10m','6m','2m','70cm'],
  'general':    ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'],
  'extra':      ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','4m','2m','70cm','23cm'],
  'full':       ['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','4m','2m','70cm','23cm'],
  // Legacy
  'A': ['160m','80m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'],
  'B': ['80m','40m','30m','20m','17m','15m','12m','10m','6m','2m','70cm'],
  'C': ['80m','40m','30m','20m','15m','10m','2m','70cm'],
};

// Power limits (W) per licence class
export const POWER_LIMITS   = { 'C': 25,   'B': 100,  'A': 1500 };
export const POWER_DEFAULTS = { 'C': 25,   'B': 75,   'A': 100  };
export const POWER_MINS     = { 'C': 1,    'B': 1,    'A': 1    };

/**
 * Return the bands accessible for the given licence class, in display order.
 * @param {string} licenseClass - 'A' | 'B' | 'C'
 * @returns {string[]}
 */
export function getActiveBands(licenseClass) {
  const lc = licenseClass ?? state.user.licenceClass ?? state.user.licenseClass;
  return (BAND_ACCESS[lc] ?? BAND_ACCESS['A']).filter(b => ALL_BANDS.includes(b));
}

/**
 * Score colour CSS variable name based on percentage.
 * @param {number} pct - 0-99
 * @returns {string} CSS var name (without var())
 */
export function scoreColorVar(pct) {
  if (pct >= 76) return '--score-excellent';
  if (pct >= 51) return '--score-good';
  if (pct >= 31) return '--score-moderate';
  if (pct >= 16) return '--score-poor';
  if (pct >= 1)  return '--score-marginal';
  return '--score-closed';
}

/**
 * Score hex colour for use in Leaflet (reads current CSS variable value).
 * Must be called after DOM is ready.
 * @param {number} pct
 * @returns {string} hex colour
 */
export function scoreToHex(pct) {
  const varName = scoreColorVar(pct);
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * Score CSS class name for text colouring.
 * @param {number} pct
 * @returns {string}
 */
export function scoreClass(pct) {
  if (pct >= 76) return 'score-excellent';
  if (pct >= 51) return 'score-good';
  if (pct >= 31) return 'score-moderate';
  if (pct >= 16) return 'score-poor';
  if (pct >= 1)  return 'score-marginal';
  return 'score-closed';
}
