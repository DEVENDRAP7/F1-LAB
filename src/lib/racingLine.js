import { dataPath } from './dataPath.js';

// Racing-line channels are committed as raw little-endian Int16 arrays,
// not JSON, to hit the ~60 KB per-driver budget (see docs/SPEC.md).
// The channel order, scale factors and byte offsets are never guessed in
// JS — they're read from the manifest the pipeline wrote alongside the
// .bin file.

/**
 * @typedef {Object} LineManifest
 * @property {number} pointCount
 * @property {string[]} channels - order of channels in the .bin file
 * @property {Object<string, number>} scale - divide raw int16 by this to
 *   recover the physical unit (e.g. x/y: 10 -> metres, speed: 10 -> km/h)
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
 * @param {string} round
 * @param {string} session
 * @param {string} driverCode
 * @param {LineManifest} manifest
 */
export async function loadRacingLine(round, session, driverCode, manifest) {
  const res = await fetch(dataPath(`2026/${round}/${session}/lines/${driverCode}.bin`));
  if (!res.ok) {
    throw new Error(`racing line not available for ${driverCode}: HTTP ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  const view = new Int16Array(buffer);
  const { channels, pointCount } = manifest;

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
