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

  it('is capped by the voice, so the top end cannot turn into a whistle', () => {
    for (const voice of Object.values(VOICES)) {
      // The floor that keeps the filter above the fundamental can lift
      // it past the ceiling; short of that, the ceiling holds.
      const capped = Math.max(firingHz(voice.redline, voice.cylinders) * 1.6, voice.ceiling);
      expect(cutoffHz(voice.redline, 1, voice), voice.id).toBeLessThanOrEqual(capped);
    }
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

describe('voice character', () => {
  const loudest = (v) => v.partials.reduce((a, p) => (p.gain > a.gain ? p : a));

  it('puts the racing engines’ energy an octave up, at the second harmonic', () => {
    // Perceived pitch follows the strongest partial. With the loudest
    // term at the fundamental these read as a growl, and neither a
    // Formula 1 V6 nor a V8 growls.
    expect(loudest(VOICES.v6).ratio).toBe(2);
    expect(loudest(VOICES.v8).ratio).toBe(2);
  });

  it('keeps the firing rate audible on the W16 without making it dominant', () => {
    // Two corrections live in this one assertion.
    //
    // The first cut sounded electric, and I read that as "the sub-octave
    // is too strong" and moved the energy up to the firing rate. That
    // was the wrong diagnosis: what made it a synth was SMOOTHNESS — a
    // static filter over a sparse clean spectrum — and moving the
    // energy up took the weight out with the drone, which is the
    // opposite complaint.
    //
    // Roughness now comes from the swept cutoff, the inharmonic order
    // and the noise, so the weight is allowed back down low. The
    // requirement is not that the firing rate dominates, only that it
    // stays loud enough to hear as combustion under the drone.
    const w16 = VOICES.w16;
    const fire = w16.partials.find((p) => p.ratio === 1).gain;
    expect(loudest(w16).ratio).toBeLessThan(1);
    expect(fire / loudest(w16).gain).toBeGreaterThanOrEqual(0.6);
  });

  it('gives the W16 weight below 200 Hz, which partials alone cannot', () => {
    // At this engine's revs the quarter-order is the only partial down
    // in the region a big engine is felt in, so the shelf does the rest.
    expect(VOICES.w16.shelf.gain).toBeGreaterThan(6);
    expect(VOICES.w16.shelf.hz).toBeLessThanOrEqual(200);
    expect(Math.min(...VOICES.w16.partials.map((p) => p.ratio))).toBeLessThanOrEqual(0.25);
  });

  it('keeps the road engines darker than the racing ones', () => {
    // They are low-revving; if either filter ever opens further than a
    // racing engine's, something has gone wrong again.
    for (const road of [VOICES.w16, VOICES.v8road]) {
      expect(road.ceiling, road.id).toBeLessThan(VOICES.v6.ceiling);
      expect(road.ceiling, road.id).toBeLessThan(VOICES.v8.ceiling);
      expect(road.noiseHz[0], road.id).toBeLessThan(VOICES.v6.noiseHz[0]);
    }
  });

  it('gives EVERY voice weight below 200 Hz', () => {
    // This is the defect that produced "why is each sound high pitched".
    // Measured off the real graph, the V6 and the V8 both had exactly
    // zero energy under 250 Hz: their lowest partial was the half-order,
    // which at these revs is already above the region an engine is felt
    // in. Nothing could be rebalanced because there was nothing there.
    // So every voice now carries a sub-fundamental partial and a low
    // shelf, and neither is optional.
    for (const voice of Object.values(VOICES)) {
      const lowest = Math.min(...voice.partials.map((p) => p.ratio));
      expect(lowest, `${voice.id} lowest partial`).toBeLessThanOrEqual(0.25);
      expect(voice.shelf?.gain, `${voice.id} shelf`).toBeGreaterThan(0);
      expect(voice.shelf.hz, `${voice.id} shelf`).toBeLessThanOrEqual(220);
    }
  });

  it('burbles on the cross-plane V8 and not on the flat-plane one', () => {
    // A road V8's banks fire unevenly, which lands energy on half and
    // three-quarter orders. A Formula 1 V8 fires evenly and makes a
    // clean harmonic series — no fractional orders at all. Putting them
    // on the racing voice would be a lie about the engine, so the test
    // holds both halves of the distinction.
    // Above the fundamental and not a whole order: 0.75 and 1.5. The
    // 0.25 sub-bass every voice now carries is NOT this — it is weight,
    // and counting it made this test claim the racing V8 burbles.
    const fractional = (v) => v.partials
      .filter((p) => p.ratio > 0.5 && p.ratio % 1 !== 0).length;
    expect(fractional(VOICES.v8road)).toBeGreaterThan(0);
    expect(fractional(VOICES.v8)).toBe(0);
    expect(VOICES.v8road.redline).toBeLessThan(VOICES.v8.redline / 2);
  });

  it('gives the W16 inharmonic content, because a chord is not an engine', () => {
    const inharmonic = (v) => v.partials.some((p) => p.ratio % 1 !== 0 && p.ratio > 1);
    expect(inharmonic(VOICES.w16)).toBe(true);
  });

  it('sweeps every voice’s filter at its own firing rate', () => {
    // A static lowpass over a steady tone is a synthesiser. The chug
    // comes from the cutoff moving with the power pulses, so no voice
    // is allowed to have no growl at all.
    for (const voice of Object.values(VOICES)) {
      expect(voice.growl?.depth, voice.id).toBeGreaterThan(0);
      expect(voice.growl.ratio, voice.id).toBeGreaterThan(0);
    }
    // The big low-revving engine is the one you feel each pulse from.
    expect(VOICES.w16.growl.depth).toBeGreaterThan(VOICES.v6.growl.depth);
    expect(VOICES.w16.growl.depth).toBeGreaterThan(VOICES.v8.growl.depth);
  });

  it('screams higher on the V8 than on the V6, at the same point in a lap', () => {
    // Eight cylinders to 18 000 against six to 15 000. This is the
    // whole reason people remember the V8s as the loud ones, and it has
    // to survive the rev mapping rather than only being true on paper.
    for (const demoRpm of [6000, 9000, 12600]) {
      const v8 = firingHz(voiceRpm(VOICES.v8, demoRpm), VOICES.v8.cylinders);
      const v6 = firingHz(voiceRpm(VOICES.v6, demoRpm), VOICES.v6.cylinders);
      expect(v8, `@${demoRpm}`).toBeGreaterThan(v6 * 1.3);
    }
  });

  it('opens each filter far enough to pass its own top order', () => {
    // A partial above the cutoff is a partial you cannot hear.
    for (const voice of Object.values(VOICES)) {
      const top = Math.max(...voice.partials.map((p) => p.ratio));
      const rpm = voice.redline * 0.85;
      expect(cutoffHz(rpm, 1, voice), voice.id)
        .toBeGreaterThan(firingHz(rpm, voice.cylinders) * top * 0.75);
    }
  });

  it('is loudest on the racing engines', () => {
    expect(VOICES.v6.trim).toBeGreaterThan(VOICES.w16.trim);
    expect(VOICES.v8.trim).toBeGreaterThan(VOICES.w16.trim);
  });
});

describe('level', () => {
  it('cannot drive the graph into clipping, even with every partial in phase', () => {
    // The worst case is every detuned oscillator lining up. A limiter
    // catches what gets past this, but the arithmetic should not need
    // it: oscillator gains are scaled by 0.18 in the graph.
    for (const voice of Object.values(VOICES)) {
      const sum = voice.partials.reduce((a, p) => a + p.gain, 0) * 0.18 + voice.noise;
      const peak = sum * engineGain(voice.redline, 1, voice) * voice.trim;
      expect(peak, voice.id).toBeLessThan(1);
    }
  });
});
