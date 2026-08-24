import { dataPath } from './dataPath.js';

// Racing-line channels are committed as raw little-endian Int16 arrays,
// not JSON, to hit the ~60 KB per-driver budget (see docs/SPEC.md).
// The channel order, scale factors and per-driver point counts are never
// guessed in JS — they're read from the manifest the pipeline wrote
// alongside the .bin files.

/**
 * @typedef {Object} LineManifest
 * @property {string[]} channels - order of channels in each .bin file
 * @property {Object<string, number>} scale - divide raw int16 by this to
 *   recover the physical unit (e.g. x/y: 10 -> metres, speed: 10 -> km/h)
 * @property {Object<string, {pointCount: number}>} drivers - one entry per
 *   exported driver; laps differ slightly in sampled length, so the count
 *   is per driver, not global
 */

export async function loadManifest(round, session) {
  const res = await fetch(dataPath(`2026/${round}/${session}/lines/manifest.json`));
  if (!res.ok) {
    throw new Error(`manifest not available for ${round}/${session}: HTTP ${res.status}`);
  }
  return /** @type {LineManifest} */ (await res.json());
}

/**
 * Decode one driver's racing line into named typed-array channels.
 * @param {string|number} round
 * @param {string} session
 * @param {string} driverCode
 * @param {LineManifest} manifest
 */
export async function loadRacingLine(round, session, driverCode, manifest) {
  const entry = manifest.drivers?.[driverCode];
  if (!entry) {
    throw new Error(`driver ${driverCode} is not listed in the manifest for ${round}/${session}`);
  }

  const res = await fetch(dataPath(`2026/${round}/${session}/lines/${driverCode}.bin`));
  if (!res.ok) {
    throw new Error(`racing line not available for ${driverCode}: HTTP ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  const view = new Int16Array(buffer);
  const { channels } = manifest;
  const pointCount = entry.pointCount;

  if (view.length !== pointCount * channels.length) {
    throw new Error(
      `${driverCode}.bin has ${view.length} values but the manifest declares ` +
        `${pointCount} points x ${channels.length} channels`,
    );
  }

  const out = {};
  channels.forEach((name, i) => {
    const channel = new Int16Array(pointCount);
    for (let p = 0; p < pointCount; p++) {
      channel[p] = view[p * channels.length + i];
    }
    out[name] = channel;
  });
  return out;
}

/** Decoded x/y (decimetre ints) as metre [x, y] pairs for the map. */
export function lineToMapPoints(channels, scale) {
  const n = channels.x.length;
  const points = new Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = [channels.x[i] / scale.x, channels.y[i] / scale.y];
  }
  return points;
}
