/**
 * HF Band Scout — Shared Utilities
 *
 * Pure helper functions: geometry, formatting, conversion.
 * No DOM access. No imports from other app modules.
 * SunCalc is available as a global (loaded via classic script tag).
 */

// ─────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────

/**
 * Haversine great-circle distance between two lat/lon points.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in km
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial bearing from point 1 to point 2 (degrees, 0=N, 90=E).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} bearing in degrees (0–360)
 */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Antipodal point of a lat/lon — used for long-path calculations.
 * @param {number} lat
 * @param {number} lon
 * @returns {{ lat: number, lon: number }}
 */
export function antipode(lat, lon) {
  return { lat: -lat, lon: lon > 0 ? lon - 180 : lon + 180 };
}

/**
 * Convert Maidenhead grid square to lat/lon centroid.
 * Supports 4- and 6-character grids.
 * @param {string} grid - e.g. "JO20ev"
 * @returns {{ lat: number, lon: number } | null}
 */
export function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;
  const g = grid.toUpperCase();
  try {
    const lon = (g.charCodeAt(0) - 65) * 20 - 180 +
                (parseInt(g[2]) * 2) +
                (g.length >= 6 ? (g.charCodeAt(4) - 65) / 12 + 1 / 24 : 1);
    const lat = (g.charCodeAt(1) - 65) * 10 - 90 +
                (parseInt(g[3]) * 1) +
                (g.length >= 6 ? (g.charCodeAt(5) - 65) / 24 + 1 / 48 : 0.5);
    if (isNaN(lon) || isNaN(lat)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/**
 * Validate Maidenhead grid square format (4 or 6 characters).
 * @param {string} grid
 * @returns {boolean}
 */
export function isValidGrid(grid) {
  return /^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?$/.test(grid);
}

/**
 * Derive IARU region from grid square (approximate).
 * @param {string} grid
 * @returns {1|2|3}
 */
export function iauRegionFromGrid(grid) {
  if (!grid || grid.length < 2) return 1;
  const col = grid.toUpperCase().charCodeAt(0) - 65; // 0-17
  const lon = col * 20 - 180 + 10;
  if (lon >= -170 && lon <= -30) return 2; // Americas
  if (lon >= 100 && lon <= 180)  return 3; // Asia-Pacific
  return 1; // Europe / Africa / Middle East
}

// ─────────────────────────────────────────────
// Callsign prefix → approximate location
// (top ~60 most common prefixes for quick lookup)
// ─────────────────────────────────────────────

const PREFIX_TABLE = {
  'ON': { lat: 50.8, lon: 4.4 },   // Belgium
  'PA': { lat: 52.3, lon: 5.3 },   // Netherlands
  'DL': { lat: 51.2, lon: 10.4 },  // Germany
  'F':  { lat: 46.8, lon: 2.4 },   // France
  'G':  { lat: 51.5, lon: -0.1 },  // England
  'I':  { lat: 41.9, lon: 12.5 },  // Italy
  'EA': { lat: 40.4, lon: -3.7 },  // Spain
  'SM': { lat: 59.3, lon: 18.1 },  // Sweden
  'OH': { lat: 60.2, lon: 25.0 },  // Finland
  'OZ': { lat: 55.7, lon: 12.6 },  // Denmark
  'LA': { lat: 59.9, lon: 10.7 },  // Norway
  'HB9':{ lat: 47.4, lon: 8.5 },   // Switzerland
  'OE': { lat: 48.2, lon: 16.4 },  // Austria
  'OK': { lat: 50.1, lon: 14.4 },  // Czech Republic
  'SP': { lat: 52.2, lon: 21.0 },  // Poland
  'HA': { lat: 47.5, lon: 19.1 },  // Hungary
  'YO': { lat: 44.4, lon: 26.1 },  // Romania
  'LZ': { lat: 42.7, lon: 23.3 },  // Bulgaria
  'UA': { lat: 55.8, lon: 37.6 },  // Russia (European)
  'W':  { lat: 39.0, lon: -98.0 }, // USA
  'K':  { lat: 39.0, lon: -98.0 }, // USA
  'N':  { lat: 39.0, lon: -98.0 }, // USA
  'VE': { lat: 56.1, lon: -106.3 },// Canada
  'VK': { lat: -25.3, lon: 133.8 },// Australia
  'ZL': { lat: -41.3, lon: 174.8 },// New Zealand
  'JA': { lat: 35.7, lon: 139.7 }, // Japan
  'HL': { lat: 37.6, lon: 127.0 }, // South Korea
  'BY': { lat: 39.9, lon: 116.4 }, // China
  'VU': { lat: 20.6, lon: 79.1 },  // India
  'ZS': { lat: -26.1, lon: 28.0 }, // South Africa
  'PY': { lat: -15.8, lon: -47.9 },// Brazil
  'LU': { lat: -34.6, lon: -58.4 },// Argentina
  'CE': { lat: -33.5, lon: -70.7 },// Chile
  'XE': { lat: 19.4, lon: -99.1 }, // Mexico
};

/**
 * Look up approximate lat/lon from a callsign prefix.
 * Tries longest match first.
 * @param {string} callsign
 * @returns {{ lat: number, lon: number } | null}
 */
export function prefixToLatLon(callsign) {
  if (!callsign) return null;
  const cs = callsign.toUpperCase().replace(/[0-9].*$/, ''); // strip suffix numbers
  // Try 3-char, then 2-char, then 1-char prefix
  for (let len = 3; len >= 1; len--) {
    const key = cs.slice(0, len);
    if (PREFIX_TABLE[key]) return PREFIX_TABLE[key];
  }
  return null;
}

// ─────────────────────────────────────────────
// Time formatting
// ─────────────────────────────────────────────

/**
 * Format a Date as "HH:MM UTC".
 * @param {Date} date
 * @returns {string}
 */
export function formatUTC(date) {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m} UTC`;
}

/**
 * Format a Date as "HH:MM" (UTC, compact).
 * @param {Date} date
 * @returns {string}
 */
export function formatUTCShort(date) {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Human-readable data age (e.g. "3m ago", "just now").
 * @param {number} fetchedAt - Date.now() timestamp
 * @returns {string}
 */
export function dataAge(fetchedAt) {
  if (!fetchedAt) return '—';
  const mins = Math.floor((Date.now() - fetchedAt) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/**
 * Format minutes as a human countdown ("47 min", "1h 12m").
 * @param {number} minutes
 * @returns {string}
 */
export function formatCountdown(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─────────────────────────────────────────────
// Number formatting
// ─────────────────────────────────────────────

/**
 * Format km distance with thousands separator.
 * @param {number} km
 * @returns {string}
 */
export function fmtKm(km) {
  return `${Math.round(km).toLocaleString()} km`;
}

/**
 * Format bearing as "NNE" etc.
 * @param {number} deg - 0-360
 * @returns {string}
 */
export function fmtBearing(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Format bearing degrees + compass label.
 * @param {number} deg
 * @returns {string}
 */
export function fmtAzimuth(deg) {
  return `${Math.round(deg)}° ${fmtBearing(deg)}`;
}

/**
 * Clamp a number between min and max.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────
// Solar helpers (require SunCalc global)
// ─────────────────────────────────────────────

/**
 * Get solar elevation in degrees at a given point and time.
 * Requires SunCalc to be loaded as a global.
 * @param {Date} date
 * @param {number} lat
 * @param {number} lon
 * @returns {number} elevation in degrees
 */
export function solarElevDeg(date, lat, lon) {
  // SunCalc is a global from lib/suncalc.js
  if (typeof SunCalc === 'undefined') return 0;
  return SunCalc.getPosition(date, lat, lon).altitude * (180 / Math.PI);
}

/**
 * Check if a point is within the greyline window (±20 min of sunrise/sunset).
 * @param {Date} date
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function isInGreyline(date, lat, lon) {
  if (typeof SunCalc === 'undefined') return false;
  const WINDOW_MS = 20 * 60 * 1000; // 20 minutes
  const times = SunCalc.getTimes(date, lat, lon);
  const now = date.getTime();
  const refs = [times.sunrise, times.sunset];
  for (const t of refs) {
    if (t instanceof Date && !isNaN(t) && Math.abs(now - t.getTime()) <= WINDOW_MS) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────
// DOM helpers (safe — no state coupling)
// ─────────────────────────────────────────────

/**
 * Show a toast message.
 * @param {string} message
 * @param {number} [durationMs=3000]
 */
export function showToast(message, durationMs = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

/**
 * Get the computed value of a CSS custom property.
 * @param {string} name - e.g. '--score-excellent'
 * @returns {string}
 */
export function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
