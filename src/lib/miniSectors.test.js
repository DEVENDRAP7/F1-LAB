import { describe, expect, it } from 'vitest';
import { miniSectors, sectorTally, winnerBySample } from './miniSectors.js';

// Speed channels are the pipeline's raw encoding: km/h x 10.
function lap(code, kph, points = 240) {
  return { code, speedRaw: new Int16Array(points).fill(kph * 10) };
}

describe('miniSectors', () => {
  it('gives every sector to the driver who was quicker everywhere', () => {
    const rows = miniSectors([lap('LEC', 200), lap('NOR', 180)], 2, 12);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.fastest === 'LEC')).toBe(true);
    expect(sectorTally(rows, ['LEC', 'NOR'])).toEqual({ LEC: 12, NOR: 0 });
  });

  it('splits them where each driver is quicker in a different half', () => {
    const fast = lap('LEC', 200);
    const slow = lap('NOR', 180);
    // NOR is quicker through the back half of the lap.
    for (let i = 120; i < 240; i += 1) {
      fast.speedRaw[i] = 150 * 10;
      slow.speedRaw[i] = 220 * 10;
    }
    const rows = miniSectors([fast, slow], 2, 12);
    const tally = sectorTally(rows, ['LEC', 'NOR']);
    expect(tally.LEC).toBe(6);
    expect(tally.NOR).toBe(6);
    expect(rows[0].fastest).toBe('LEC');
    expect(rows[11].fastest).toBe('NOR');
  });

  it('states the margin to the next driver, not to the field', () => {
    const rows = miniSectors([lap('LEC', 200), lap('NOR', 180), lap('HAM', 100)], 2, 4);
    for (const row of rows) {
      const times = Object.fromEntries(row.times.map((t) => [t.code, t.timeS]));
      expect(row.marginS).toBeCloseTo(times.NOR - times.LEC, 9);
    }
  });

  it('has no margin to report for a single driver', () => {
    const [row] = miniSectors([lap('LEC', 200)], 2, 1);
    expect(row.marginS).toBeNull();
    expect(row.fastest).toBe('LEC');
  });

  it('covers the whole lap: the sector times add up to the lap time', () => {
    const rows = miniSectors([lap('LEC', 200)], 2, 24);
    const summed = rows.reduce((total, row) => total + row.times[0].timeS, 0);
    // 240 samples of 2 m at 200 km/h.
    const expected = (239 * 2) / (200 / 3.6);
    expect(summed).toBeCloseTo(expected, 6);
  });

  it('compares the same piece of circuit when laps differ in length', () => {
    // A racing line is a measured path, so two drivers' laps are not
    // exactly the same number of samples. Sectors are fractions of each
    // driver's own lap for that reason.
    const long = lap('LEC', 200, 245);
    const short = lap('NOR', 200, 239);
    const rows = miniSectors([long, short], 2, 12);
    for (const row of rows) {
      const [a, b] = row.times;
      expect(Math.abs(a.timeS - b.timeS)).toBeLessThan(0.05);
    }
  });
});

describe('winnerBySample', () => {
  it('paints each sample with the sector it falls in', () => {
    const rows = [
      { sector: 1, fastestIndex: 0 },
      { sector: 2, fastestIndex: 1 },
    ];
    const series = winnerBySample(rows, 100, 2);
    expect(series[0]).toBe(0);
    expect(series[49]).toBe(0);
    expect(series[99]).toBe(1);
  });

  it('has nothing to paint without sectors', () => {
    expect(winnerBySample([], 10, 4)).toEqual(new Array(10).fill(0));
  });
});
