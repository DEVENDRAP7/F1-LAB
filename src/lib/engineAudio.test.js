import { describe, expect, it } from 'vitest';
import { cutoffHz, engineGain, firingHz } from './engineAudio.js';

describe('firingHz', () => {
  it('is the four-stroke firing frequency, not the crank speed', () => {
    // A V6 at 12 000 rpm fires 600 times a second: 200 rev/s, three
    // firings per revolution. Getting this wrong by the factor of two
    // is the classic way to end up an octave out.
    expect(firingHz(12000, 6)).toBe(600);
    expect(firingHz(12000, 8)).toBe(800);
    expect(firingHz(0, 6)).toBe(0);
  });

  it('rises with revs', () => {
    expect(firingHz(15000)).toBeGreaterThan(firingHz(4000));
  });
});

describe('cutoffHz', () => {
  it('opens with throttle at the same revs', () => {
    expect(cutoffHz(9000, 1)).toBeGreaterThan(cutoffHz(9000, 0));
  });

  it('stays above the fundamental it has to pass', () => {
    // A cutoff under the firing frequency would silence the note it is
    // supposed to be shaping.
    for (let rpm = 3000; rpm <= 15000; rpm += 500) {
      expect(cutoffHz(rpm, 0), `${rpm} rpm closed throttle`)
        .toBeGreaterThan(firingHz(rpm));
    }
  });

  it('is capped, so the top end cannot turn into a whistle', () => {
    expect(cutoffHz(15000, 1)).toBeLessThanOrEqual(6200);
  });
});

describe('engineGain', () => {
  it('is audible at idle and never full scale', () => {
    expect(engineGain(4000, 0.1)).toBeGreaterThan(0.1);
    expect(engineGain(15000, 1)).toBeLessThanOrEqual(0.9);
  });
});
