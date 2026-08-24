import { describe, expect, it } from 'vitest';
import { cumulativeTimes, deltaTrace, lapTimeSeconds } from './delta.js';

describe('cumulativeTimes', () => {
  it('integrates a constant 100 km/h correctly over the grid', () => {
    // 50 points at 2 m spacing = 49 segments = 98 m.
    // 100 km/h = 1000 raw = 27.777... m/s -> 98 / 27.777... = 3.528 s
    const speed = new Int16Array(50).fill(1000);
    const times = cumulativeTimes(speed, 2);

    expect(times[0]).toBe(0);
    expect(times[49]).toBeCloseTo(98 / (1000 / 36), 9);
  });

  it('clamps stationary samples instead of producing Infinity', () => {
    const speed = new Int16Array([1000, 0, 1000]);
    const times = cumulativeTimes(speed, 2);
    expect(Number.isFinite(times[2])).toBe(true);
  });
});

describe('deltaTrace', () => {
  it('is zero everywhere for identical laps', () => {
    const speed = new Int16Array(100).fill(2500);
    const delta = deltaTrace(speed, speed, 2);
    expect(Math.max(...delta.map(Math.abs))).toBe(0);
  });

  it('final element equals the lap-time gap exactly', () => {
    const fast = new Int16Array(200).fill(2600);
    const slow = new Int16Array(200).fill(2500);
    const delta = deltaTrace(fast, slow, 2);

    const gap = lapTimeSeconds(slow, 2) - lapTimeSeconds(fast, 2);
    expect(delta[delta.length - 1]).toBeCloseTo(gap, 12);
    expect(gap).toBeGreaterThan(0);
  });

  it('truncates to the shorter lap rather than throwing', () => {
    const a = new Int16Array(100).fill(2000);
    const b = new Int16Array(80).fill(2000);
    expect(deltaTrace(a, b, 2)).toHaveLength(80);
  });
});
