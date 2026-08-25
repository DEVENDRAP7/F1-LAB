import { describe, expect, it } from 'vitest';
import { addStop, lapsCovered, removeStint, setCompound, setLaps } from './strategyEdit.js';

const TWO_STOP = [
  { compound: 'MEDIUM', laps: 22 },
  { compound: 'HARD', laps: 31 },
  { compound: 'HARD', laps: 17 },
];

describe('editing a strategy', () => {
  it('keeps the race distance when a stop is added', () => {
    const next = addStop(TWO_STOP);
    expect(next).toHaveLength(4);
    expect(lapsCovered(next)).toBe(lapsCovered(TWO_STOP));
  });

  it('splits the longest stint, not the first one', () => {
    const next = addStop(TWO_STOP);
    // The 31-lap stint is the one with room to divide.
    expect(next.map((s) => s.laps)).toEqual([22, 15, 16, 17]);
  });

  it('refuses to split a stint that cannot be divided', () => {
    const single = [{ compound: 'SOFT', laps: 1 }];
    expect(addStop(single)).toBe(single);
  });

  it('keeps the race distance when a stop is removed', () => {
    const next = removeStint(TWO_STOP, 1);
    expect(next).toHaveLength(2);
    expect(lapsCovered(next)).toBe(lapsCovered(TWO_STOP));
    // The removed stint's laps went to the stint that follows it.
    expect(next.map((s) => s.laps)).toEqual([22, 48]);
  });

  it('gives the last stint back to the one before it', () => {
    const next = removeStint(TWO_STOP, 2);
    expect(next.map((s) => s.laps)).toEqual([22, 48]);
    expect(lapsCovered(next)).toBe(lapsCovered(TWO_STOP));
  });

  it('never leaves a strategy with no stints', () => {
    const one = [{ compound: 'SOFT', laps: 44 }];
    expect(removeStint(one, 0)).toBe(one);
  });

  it('clamps a stint to at least one lap', () => {
    expect(setLaps(TWO_STOP, 0, 0)[0].laps).toBe(1);
    expect(setLaps(TWO_STOP, 0, -5)[0].laps).toBe(1);
  });

  it('changes a compound without touching the lap counts', () => {
    const next = setCompound(TWO_STOP, 0, 'SOFT');
    expect(next[0]).toEqual({ compound: 'SOFT', laps: 22 });
    expect(lapsCovered(next)).toBe(lapsCovered(TWO_STOP));
  });
});
