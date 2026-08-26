import { cumulativeTimes } from './delta.js';
import { miniSectors } from './miniSectors.js';

// What the race costs a lap, measured rather than assumed.
//
// The same driver, the same circuit, two sessions: a qualifying lap on
// low fuel and fresh tyres, and their fastest lap of the race. The
// difference between those is the thing every strategy conversation is
// actually about, and it is sitting in two artifacts this project
// already publishes.
//
// It is NOT a fuel-and-tyre number. The gap contains fuel load, tyre
// age and compound, engine mode, traffic, and a track that has rubbered
// in over a weekend — and nothing here separates them. What it is, is
// the measured cost of the same driver doing the same lap under race
// conditions, broken down by where on the circuit it was paid.

/**
 * Compare one driver's qualifying and race laps.
 *
 * Both `qualifying` and `race` are { speedRaw, lapTimeS }. Sectors are
 * fractions of each lap, as in miniSectors, because the two laps are
 * measured paths of slightly different length.
 */
export function sessionCost(qualifying, race, spacingM, sectorCount = 12) {
  if (!qualifying?.speedRaw?.length || !race?.speedRaw?.length) return null;

  const qTimes = cumulativeTimes(qualifying.speedRaw, spacingM);
  const rTimes = cumulativeTimes(race.speedRaw, spacingM);
  const qLap = qTimes[qTimes.length - 1];
  const rLap = rTimes[rTimes.length - 1];

  const rows = miniSectors(
    [
      { code: 'Q', speedRaw: qualifying.speedRaw },
      { code: 'R', speedRaw: race.speedRaw },
    ],
    spacingM,
    sectorCount,
  ).map((row) => {
    const q = row.times.find((t) => t.code === 'Q').timeS;
    const r = row.times.find((t) => t.code === 'R').timeS;
    return { sector: row.sector, qualifyingS: q, raceS: r, costS: r - q };
  });

  return {
    // Integrated from the speed channels, so the two are measured the
    // same way. The official lap times are carried alongside rather than
    // mixed in: they come from a different source and comparing one of
    // each would put two measurement methods in the same subtraction.
    integratedQualifyingS: qLap,
    integratedRaceS: rLap,
    integratedCostS: rLap - qLap,
    officialQualifyingS: qualifying.lapTimeS ?? null,
    officialRaceS: race.lapTimeS ?? null,
    officialCostS:
      qualifying.lapTimeS != null && race.lapTimeS != null
        ? race.lapTimeS - qualifying.lapTimeS
        : null,
    topSpeedCostKph: maxOf(race.speedRaw) / 10 - maxOf(qualifying.speedRaw) / 10,
    sectors: rows,
    // Where it was paid: the sector that cost the most, and its share of
    // the whole. A lap that loses evenly and a lap that loses it all in
    // one corner are different races.
    worstSector: rows.reduce((worst, row) => (row.costS > worst.costS ? row : worst), rows[0]),
  };
}

function maxOf(values) {
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) if (values[i] > max) max = values[i];
  return max;
}
