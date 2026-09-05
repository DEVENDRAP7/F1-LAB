import { describe, expect, it } from 'vitest';
import {
  VOICES, cutoffHz, engineGain, firingHz, halfOrderHz, pulseCurve, voiceRpm,
} from './engineAudio.js';

describe('firingHz', () => {
  it('is the four-stroke firing frequency, not the crank speed', () => {
    // A V6 at 12 000 rpm fires 600 times a second: 200 rev/s, three
    // firings per revolution. Getting this wrong by the factor of two
    // is the classic way to end up an octave out.
    expect(firingHz(12000, 6)).toBe(600);
    expect(firingHz(12000, 8)).toBe(800);
    expect(firingHz(0, 6)).toBe(0);
  });
});

describe('halfOrderHz', () => {
  it('is the crank at half speed, and does not depend on cylinder count', () => {
    // This is where an engine's weight lives. Four earlier versions
    // built the whole spectrum UPWARD from the firing rate — about
    // 600 Hz at demo revs — so nothing significant existed below 150 Hz
    // and there was no bass to be had at any setting.
    expect(halfOrderHz(12000)).toBe(100);
    expect(halfOrderHz(12600)).toBe(105);
    expect(halfOrderHz(6000)).toBe(50);
  });

  it('sits far below the firing rate at every rev the demos use', () => {
    for (const rpm of [4200, 9000, 12600, 14850]) {
      expect(halfOrderHz(rpm)).toBeLessThan(firingHz(rpm, 6) / 4);
      expect(halfOrderHz(rpm)).toBeLessThan(260);
    }
  });
});

describe('the voices', () => {
  it('makes the half-order sub the loudest layer, or near it', () => {
    // The bass has to be the biggest thing in the mix, not a garnish on
    // top of a firing-rate buzz. That inversion is what "no bass at all"
    // meant, and it survived four rounds of rebalancing harmonics.
    for (const voice of Object.values(VOICES)) {
      expect(voice.sub, voice.id).toBeGreaterThanOrEqual(voice.body);
      expect(voice.sub, voice.id).toBeGreaterThan(voice.buzz * 2);
    }
  });

  it('keeps the firing buzz quiet', () => {
    // A sawtooth at the firing rate is the edge of the sound, not the
    // sound. Loud, and detuned against copies of itself, it is a
    // supersaw — which is exactly what four earlier versions were.
    for (const voice of Object.values(VOICES)) {
      expect(voice.buzz, voice.id).toBeLessThan(0.4);
    }
  });

  it('gives every voice fixed resonances that do not move with revs', () => {
    // The part that makes a sound belong to a physical object: an
    // exhaust and a body shell ring at their own frequencies whatever
    // the engine does. A spectrum where every feature slides together
    // is the definition of synthetic.
    for (const voice of Object.values(VOICES)) {
      expect(voice.formants.length, voice.id).toBeGreaterThanOrEqual(2);
      const [lowest] = voice.formants[0];
      expect(lowest, `${voice.id} lowest resonance`).toBeLessThan(220);
      let previous = 0;
      for (const [hz, q, gain] of voice.formants) {
        expect(hz, voice.id).toBeGreaterThan(previous);
        expect(q, voice.id).toBeGreaterThan(1);
        expect(gain, voice.id).toBeGreaterThan(0);
        previous = hz;
      }
    }
  });

  it('gates every voice at its combustion rate', () => {
    for (const voice of Object.values(VOICES)) {
      expect(voice.pulse.depth, voice.id).toBeGreaterThan(0.3);
      expect(voice.pulse.sharp, voice.id).toBeGreaterThan(1);
    }
  });

  it('keeps every ceiling low enough to be a roar and not a buzz', () => {
    for (const voice of Object.values(VOICES)) {
      expect(voice.ceiling, voice.id).toBeLessThanOrEqual(5400);
    }
    // The road engines stay darker than the racing ones.
    expect(VOICES.w16.ceiling).toBeLessThan(VOICES.v6.ceiling);
    expect(VOICES.v8road.ceiling).toBeLessThan(VOICES.v8.ceiling);
  });

  it('gives every voice real low-shelf weight', () => {
    for (const voice of Object.values(VOICES)) {
      expect(voice.shelf.gain, voice.id).toBeGreaterThan(6);
      expect(voice.shelf.hz, voice.id).toBeLessThanOrEqual(220);
    }
  });

  it('leaves headroom: no voice is trimmed to clip', () => {
    // Rendered offline, the first pass at these levels peaked at 1.0 on
    // three of four voices and sat in the limiter the whole run.
    for (const voice of Object.values(VOICES)) {
      expect(voice.trim, voice.id).toBeLessThan(0.5);
    }
  });

  it('says out loud that the W16 and the road V8 are not Formula 1 engines', () => {
    expect(VOICES.w16.note).toMatch(/not a formula 1 engine/i);
    expect(VOICES.v8road.note).toMatch(/not a formula 1 engine/i);
  });
});

describe('voiceRpm', () => {
  it('maps a demo rev sweep onto each engine’s own range', () => {
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

  it('screams higher on the V8 than on the V6, at the same point in a lap', () => {
    for (const demoRpm of [6000, 9000, 12600]) {
      const v8 = firingHz(voiceRpm(VOICES.v8, demoRpm), VOICES.v8.cylinders);
      const v6 = firingHz(voiceRpm(VOICES.v6, demoRpm), VOICES.v6.cylinders);
      expect(v8, `@${demoRpm}`).toBeGreaterThan(v6 * 1.3);
    }
  });
});

describe('cutoffHz', () => {
  it('opens with throttle at the same revs, and is capped by the voice', () => {
    expect(cutoffHz(9000, 1, VOICES.v6)).toBeGreaterThan(cutoffHz(9000, 0, VOICES.v6));
    for (const voice of Object.values(VOICES)) {
      expect(cutoffHz(voice.redline, 1, voice), voice.id)
        .toBeLessThanOrEqual(voice.ceiling);
    }
  });

  it('never closes below the half-order it has to pass', () => {
    // The sub is the loudest layer; filtering it out would take the bass
    // with it and put this back where it started.
    for (const voice of Object.values(VOICES)) {
      for (let rpm = voice.idle; rpm <= voice.redline; rpm += 200) {
        expect(cutoffHz(rpm, 0, voice), `${voice.id} @${rpm}`)
          .toBeGreaterThan(halfOrderHz(rpm) * 2);
      }
    }
  });
});

describe('engineGain', () => {
  it('is audible at idle and never full scale', () => {
    expect(engineGain(4000, 0.1, VOICES.v6)).toBeGreaterThan(0.1);
    expect(engineGain(15000, 1, VOICES.v6)).toBeLessThanOrEqual(0.9);
  });
});

describe('pulseCurve', () => {
  it('starts open and decays shut', () => {
    const curve = pulseCurve(4, 512);
    expect(curve[0]).toBeCloseTo(1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 6);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
    }
  });

  it('spends more of the cycle shut the sharper it is', () => {
    const area = (c) => c.reduce((a, v) => a + v, 0);
    expect(area(pulseCurve(9, 512))).toBeLessThan(area(pulseCurve(2, 512)));
  });
});
