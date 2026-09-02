import { describe, expect, it } from 'vitest';
import { VOICES, cutoffHz, engineGain, firingHz, voiceRpm } from './engineAudio.js';

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

describe('voices', () => {
  it('maps a demo rev sweep onto each engine’s own range', () => {
    // The sequences are written in Formula 1 revs. Handing 12 600 to an
    // engine that stops at 6 700 has to land inside its range, not three
    // times past its limiter.
    for (const voice of Object.values(VOICES)) {
      expect(voiceRpm(voice, VOICES.v6.idle)).toBeCloseTo(voice.idle, 5);
      expect(voiceRpm(voice, VOICES.v6.redline)).toBeCloseTo(voice.redline, 5);
      for (const rpm of [0, 4000, 9000, 12600, 15000, 30000]) {
        const own = voiceRpm(voice, rpm);
        expect(own, `${voice.id} @${rpm}`).toBeGreaterThanOrEqual(voice.idle);
        expect(own, `${voice.id} @${rpm}`).toBeLessThanOrEqual(voice.redline);
      }
    }
  });

  it('never lets a voice’s filter close under its own fundamental', () => {
    // The W16 has a 3 000 Hz ceiling and sixteen cylinders; a flat cap
    // would have silenced the note it is supposed to be shaping.
    for (const voice of Object.values(VOICES)) {
      for (let rpm = voice.idle; rpm <= voice.redline; rpm += 200) {
        expect(cutoffHz(rpm, 0, voice), `${voice.id} @${rpm}`)
          .toBeGreaterThan(firingHz(rpm, voice.cylinders));
      }
    }
  });

  it('gives the W16 its weight in the low orders and the V6 in the harmonics', () => {
    const low = (v) => v.partials.filter((p) => p.ratio < 1)
      .reduce((a, p) => a + p.gain, 0);
    const high = (v) => v.partials.filter((p) => p.ratio > 1)
      .reduce((a, p) => a + p.gain, 0);
    expect(low(VOICES.w16)).toBeGreaterThan(low(VOICES.v6));
    expect(high(VOICES.v6)).toBeGreaterThan(high(VOICES.w16));
  });

  it('says out loud that the W16 is not a Formula 1 engine', () => {
    expect(VOICES.w16.note).toMatch(/not a formula 1 engine/i);
  });
});
