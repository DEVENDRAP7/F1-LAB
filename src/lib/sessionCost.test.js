import { describe, expect, it } from 'vitest';
import { sessionCost } from './sessionCost.js';

function lap(kph, points = 240) {
  return { speedRaw: new Int16Array(points).fill(kph * 10) };
}

describe('sessionCost', () => {
  it('measures the cost as the difference between the two laps', () => {
    const cost = sessionCost({ ...lap(200), lapTimeS: 80 }, { ...lap(180), lapTimeS: 84 }, 2, 4);
    expect(cost.integratedCostS).toBeGreaterThan(0);
    expect(cost.officialCostS).toBe(4);
    expect(cost.sectors).toHaveLength(4);
    expect(cost.sectors.every((s) => s.costS > 0)).toBe(true);
  });

  it('keeps the integrated and the official figures apart', () => {
    // They come from different sources, and mixing one of each into the
    // same subtraction would compare two measurement methods.
    const cost = sessionCost({ ...lap(200), lapTimeS: 71.1 }, { ...lap(190), lapTimeS: 74.2 }, 2);
    expect(cost.officialCostS).toBeCloseTo(3.1, 6);
    expect(cost.integratedCostS).not.toBe(cost.officialCostS);
    expect(cost.integratedQualifyingS).toBeGreaterThan(0);
  });

  it('finds the sector where the cost was paid', () => {
    const q = lap(200);
    const r = lap(200);
    // The race lap only loses in the last quarter.
    for (let i = 180; i < 240; i += 1) r.speedRaw[i] = 120 * 10;
    const cost = sessionCost(q, r, 2, 4);
    expect(cost.worstSector.sector).toBe(4);
    expect(cost.sectors[0].costS).toBeCloseTo(0, 6);
  });

  it('reports a slower race top speed as a cost', () => {
    const cost = sessionCost(lap(320), lap(300), 2, 4);
    expect(cost.topSpeedCostKph).toBeCloseTo(-20, 6);
  });

  it('has nothing to compare when a session is missing', () => {
    expect(sessionCost(null, lap(200), 2)).toBeNull();
    expect(sessionCost(lap(200), { speedRaw: new Int16Array(0) }, 2)).toBeNull();
  });
});
