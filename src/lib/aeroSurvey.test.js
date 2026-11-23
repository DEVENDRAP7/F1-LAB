import { describe, expect, it } from 'vitest';
import { seasonSurvey } from './aeroSurvey.js';

describe('seasonSurvey', () => {
  it('takes medians, so one freak lap does not move the claim', () => {
    const laps = [
      { cornerModelErrorPct: 8, coastSamples: 0 },
      { cornerModelErrorPct: 10, coastSamples: 1 },
      { cornerModelErrorPct: 12, coastSamples: 2 },
      { cornerModelErrorPct: 400, coastSamples: 900 },
      { cornerModelErrorPct: 11, coastSamples: 0 },
    ];
    const s = seasonSurvey(laps);
    expect(s.medianModelErrorPct).toBe(11);
    expect(s.medianCoastSamples).toBe(1);
  });

  it('averages the middle pair for an even count', () => {
    const s = seasonSurvey([
      { cornerModelErrorPct: 10, coastSamples: 1 },
      { cornerModelErrorPct: 13, coastSamples: 2 },
    ]);
    expect(s.medianModelErrorPct).toBe(11.5);
    expect(s.medianCoastSamples).toBe(1.5);
  });

  it('counts the laps with no coasting at all', () => {
    const s = seasonSurvey([
      { coastSamples: 0 }, { coastSamples: 0 }, { coastSamples: 3 }, { coastSamples: 0 },
    ]);
    expect(s.lapsWithoutCoast).toBe(3);
    expect(s.coastLaps).toBe(4);
  });

  it('leaves a lap out of only the claim it has no value for', () => {
    // A lap with no detectable turns has no corner-model error but still
    // has a coasting count; the sentence about model error must say it
    // covers two laps, not three.
    const s = seasonSurvey([
      { cornerModelErrorPct: 9, coastSamples: 4 },
      { cornerModelErrorPct: null, coastSamples: 0 },
      { cornerModelErrorPct: 11, coastSamples: 2 },
    ]);
    expect(s.laps).toBe(3);
    expect(s.modelLaps).toBe(2);
    expect(s.coastLaps).toBe(3);
    expect(s.medianModelErrorPct).toBe(10);
  });

  it('says nothing rather than inventing a number for an empty or absent list', () => {
    for (const input of [[], undefined, null]) {
      const s = seasonSurvey(input);
      expect(s.laps).toBe(0);
      expect(s.medianModelErrorPct).toBeNull();
      expect(s.medianCoastSamples).toBeNull();
      expect(s.lapsWithoutCoast).toBe(0);
    }
  });

  it('ignores values that are not numbers', () => {
    const s = seasonSurvey([
      { cornerModelErrorPct: Number.NaN, coastSamples: '3' },
      { cornerModelErrorPct: 7, coastSamples: 1 },
    ]);
    expect(s.modelLaps).toBe(1);
    expect(s.medianModelErrorPct).toBe(7);
    expect(s.coastLaps).toBe(1);
  });
});
