/**
 * cache.js
 * Builds state.scoreCache: DXCC × band × 48 time steps → score.
 * Uses chunked async processing to avoid blocking the UI thread.
 *
 * scoreCache shape:
 * {
 *   [dxccId]: {
 *     name, prefix, continent, lat, lon, feature,   // DXCC metadata
 *     steps: {                                       // 0..47
 *       [step]: { "20m": 72, "40m": 45, … }
 *     }
 *   }
 * }
 */

import { state, ALL_BANDS, getActiveBands } from './state.js';
import { calcReliability } from './propagation.js';
import { getKpAtStep }     from './noaa.js';

const TOTAL_STEPS    = 48;
const CHUNK_SIZE     = 30;   // DXCC entities per animation-frame chunk
const STEP_MINUTES   = 30;

// ─── Progress callback type ─────────────────────────────────────────────────
// onProgress(pct: 0–100, label: string) → void

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the full score cache from loaded GeoJSON features.
 * @param {GeoJSON.Feature[]} features   - DXCC GeoJSON features
 * @param {function}          onProgress - optional progress callback
 * @returns {Promise<void>}
 */
export async function buildCache(features, onProgress) {
  if (!features || features.length === 0) {
    console.warn('[cache] No features provided');
    return;
  }

  const userLat  = state.user.lat;
  const userLon  = state.user.lon;
  const userGrid = state.user.grid;

  if (!userLat && !userGrid) {
    console.warn('[cache] No user location; cache will use defaults');
  }

  const newCache = {};
  const total    = features.length;
  let   done     = 0;

  // Process in chunks to yield to the UI thread
  for (let chunkStart = 0; chunkStart < total; chunkStart += CHUNK_SIZE) {
    const chunk = features.slice(chunkStart, Math.min(chunkStart + CHUNK_SIZE, total));

    for (const feature of chunk) {
      const props = feature.properties ?? {};
      const dxccId = props.dxcc_id ?? props.prefix ?? String(chunkStart);

      const dxccLat = props.lat ?? getCentroidLat(feature);
      const dxccLon = props.lon ?? getCentroidLon(feature);

      const steps = {};

      for (let step = 0; step < TOTAL_STEPS; step++) {
        const stepScores = {};
        const date       = stepToDate(step);
        const kp         = getKpAtStep(step);
        const sfi        = state.noaa?.sfi ?? 120;

        for (const band of getActiveBands()) {
          try {
            const result = calcReliability({
              txLat: userLat ?? 52,
              txLon: userLon ?? 5,
              rxLat: dxccLat,
              rxLon: dxccLon,
              band,
              time:    date,
              sfi,
              kp,
              txPowerW: state.user.powerW ?? 100,
              mode:    state.user.mode   ?? 'ssb',
            });
            stepScores[band] = result.score ?? 0;
          } catch (e) {
            stepScores[band] = 0;
          }
        }

        steps[step] = stepScores;
      }

      newCache[dxccId] = {
        name:      props.name      ?? dxccId,
        prefix:    props.prefix    ?? '?',
        continent: props.continent ?? 'EU',
        cqZone:    props.cq_zone   ?? 0,
        ituZone:   props.itu_zone  ?? 0,
        lat:       dxccLat,
        lon:       dxccLon,
        feature,
        steps,
      };

      done++;
    }

    // Yield to browser
    await yieldToUI();

    if (onProgress) {
      onProgress(Math.round((done / total) * 100), `${done} / ${total}`);
    }
  }

  // Atomic swap
  state.scoreCache    = newCache;
  state.scoreCacheBuilt = true;
}

/**
 * Rebuild cache for a single DXCC entry (e.g. after settings change).
 * Fast because it's one entity × 48 steps.
 */
export async function rebuildEntry(dxccId) {
  const entry = state.scoreCache?.[dxccId];
  if (!entry) return;

  const sfi      = state.noaa?.sfi ?? 120;

  for (let step = 0; step < TOTAL_STEPS; step++) {
    const stepScores = {};
    const date       = stepToDate(step);
    const kp         = getKpAtStep(step);

    for (const band of getActiveBands()) {
      try {
        const result = calcReliability({
          txLat: state.user.lat ?? 52,
          txLon: state.user.lon ?? 5,
          rxLat: entry.lat,
          rxLon: entry.lon,
          band,
          time:    date,
          sfi,
          kp,
          txPowerW: state.user.powerW ?? 100,
          mode:    state.user.mode   ?? 'ssb',
        });
        stepScores[band] = result.score ?? 0;
      } catch {
        stepScores[band] = 0;
      }
    }

    entry.steps[step] = stepScores;
  }
}

/**
 * Fully invalidate cache (e.g. after settings change).
 * Callers should then call buildCache() again.
 */
export function invalidateCache() {
  state.scoreCache = {};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a step index (0–47) to a Date object.
 * Steps map onto today's UTC 24h starting from midnight.
 */
export function stepToDate(step) {
  const now   = new Date();
  const base  = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0,
  ));
  base.setUTCMinutes(step * STEP_MINUTES);
  return base;
}

function yieldToUI() {
  // setTimeout ipv requestAnimationFrame — werkt ook in achtergrond-tabs
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Simple centroid extraction from GeoJSON geometry
function getCentroidLat(feature) {
  try {
    const coords = flattenCoords(feature.geometry);
    if (coords.length === 0) return 0;
    return coords.reduce((s, c) => s + c[1], 0) / coords.length;
  } catch { return 0; }
}

function getCentroidLon(feature) {
  try {
    const coords = flattenCoords(feature.geometry);
    if (coords.length === 0) return 0;
    return coords.reduce((s, c) => s + c[0], 0) / coords.length;
  } catch { return 0; }
}

function flattenCoords(geometry) {
  if (!geometry) return [];
  const type = geometry.type;
  let rings = [];

  if (type === 'Polygon') {
    rings = geometry.coordinates;
  } else if (type === 'MultiPolygon') {
    rings = geometry.coordinates.flat(1);
  } else if (type === 'Point') {
    return [geometry.coordinates];
  } else if (type === 'MultiPoint' || type === 'LineString') {
    return geometry.coordinates;
  }

  return rings.flat(1);
}
