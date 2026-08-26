import { cumulativeTimes } from './delta.js';

// Who was fastest where.
//
// The lap is cut into equal fractions of itself and each driver's time
// through each piece is read off the same cumulative-time curve the delta
// trace already uses — so this panel and the delta chart above it cannot
// disagree about who gained where.
//
// Fractions of the lap rather than fixed distances, because two drivers'
// laps are not exactly the same length: each is a measured path, and the
// racing lines differ by a few metres over a lap. Cutting at "a
// twenty-fourth of this driver's own lap" compares the same piece of
// circuit; cutting at "every 180 m" would slowly shear one driver's
// sectors against another's.
//
// This is not the sport's timing-loop mini-sector split. Nothing here
// publishes where those loops are, so these are this project's own even
// division, and the UI says so.

export const DEFAULT_SECTORS = 24;

/**
 * Per-sector times for each driver, and who took each one.
 *
 * `laps` is [{ code, speedRaw }]; `spacingM` is the grid spacing the
 * channels were resampled onto. Returns one row per sector with every
 * driver's time through it, the fastest, and the margin to the next.
 */
export function miniSectors(laps, spacingM, sectorCount = DEFAULT_SECTORS) {
  if (!laps || laps.length === 0 || sectorCount < 1) return [];

  const curves = laps.map((lap) => ({
    code: lap.code,
    cumulative: cumulativeTimes(lap.speedRaw, spacingM),
    length: lap.speedRaw.length,
  }));

  const rows = [];
  for (let sector = 0; sector < sectorCount; sector += 1) {
    const times = curves.map((curve) => {
      // Boundaries land on this driver's own grid, so the last sector
      // ends on the last sample rather than one short of it.
      const start = Math.round((sector / sectorCount) * (curve.length - 1));
      const end = Math.round(((sector + 1) / sectorCount) * (curve.length - 1));
      return { code: curve.code, timeS: curve.cumulative[end] - curve.cumulative[start] };
    });

    const ordered = [...times].sort((a, b) => a.timeS - b.timeS);
    rows.push({
      sector: sector + 1,
      times,
      fastest: ordered[0].code,
      fastestIndex: laps.findIndex((lap) => lap.code === ordered[0].code),
      // Nothing to be ahead of with one driver selected: the margin is
      // null rather than zero, which would read as a dead heat.
      marginS: ordered.length > 1 ? ordered[1].timeS - ordered[0].timeS : null,
    });
  }
  return rows;
}

/**
 * A per-sample series naming the winning driver's index, for a map that
 * colours the track by who was fastest through each piece of it.
 *
 * Built against one driver's grid — whichever lap is being drawn — since
 * that is the geometry the colour is painted onto.
 */
export function winnerBySample(rows, pointCount, sectorCount = DEFAULT_SECTORS) {
  const out = new Array(pointCount).fill(0);
  if (rows.length === 0 || pointCount === 0) return out;
  for (let i = 0; i < pointCount; i += 1) {
    const sector = Math.min(
      sectorCount - 1,
      Math.floor((i / Math.max(1, pointCount - 1)) * sectorCount),
    );
    out[i] = rows[sector]?.fastestIndex ?? 0;
  }
  return out;
}

/** How many sectors each driver took, for a one-line summary. */
export function sectorTally(rows, codes) {
  const tally = Object.fromEntries(codes.map((code) => [code, 0]));
  for (const row of rows) {
    if (row.fastest in tally) tally[row.fastest] += 1;
  }
  return tally;
}
