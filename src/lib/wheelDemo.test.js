import { describe, expect, it } from 'vitest';
import { DEMOS, channelAt, stateAt } from './wheelDemo.js';
import { atRevLimit, lampTone, litLamps } from './steeringWheel.js';

const byId = (id) => DEMOS.find((d) => d.id === id);

describe('channelAt', () => {
  const frames = [
    { t: 0, rpm: 4000, gear: 0 },
    { t: 2, rpm: 12000 },
    { t: 2, gear: 1 },
    { t: 4, rpm: 8000, gear: 2 },
  ];

  it('slides a continuous channel between its own keyframes', () => {
    expect(channelAt(frames, 'rpm', 0)).toBe(4000);
    expect(channelAt(frames, 'rpm', 1)).toBe(8000);
    expect(channelAt(frames, 'rpm', 2)).toBe(12000);
    expect(channelAt(frames, 'rpm', 3)).toBe(10000);
  });

  it('steps a discrete channel, and holds it until the next one', () => {
    expect(channelAt(frames, 'gear', 1.9)).toBe(0);
    expect(channelAt(frames, 'gear', 2)).toBe(1);
    expect(channelAt(frames, 'gear', 3.9)).toBe(1);
    expect(channelAt(frames, 'gear', 4)).toBe(2);
  });

  it('reads a channel whose first keyframe is later than t', () => {
    expect(channelAt([{ t: 5, speed: 100 }], 'speed', 0)).toBe(100);
  });
});

describe('stateAt', () => {
  it('clamps to the demo, so a frame past the end is still valid', () => {
    for (const demo of DEMOS) {
      const end = stateAt(demo, demo.duration);
      expect(stateAt(demo, demo.duration + 5)).toEqual(end);
      expect(stateAt(demo, -3)).toEqual(stateAt(demo, 0));
    }
  });

  it('gives every demo a complete state at every moment', () => {
    for (const demo of DEMOS) {
      for (let t = 0; t <= demo.duration; t += 0.25) {
        const s = stateAt(demo, t);
        for (const key of ['gear', 'rpm', 'speed', 'throttle', 'mode', 'strategy', 'engine', 'caption']) {
          expect(s[key], `${demo.id} @${t} ${key}`).not.toBeUndefined();
        }
        expect(s.rpm, `${demo.id} @${t} rpm`).toBeGreaterThan(0);
        expect(s.rpm, `${demo.id} @${t} rpm`).toBeLessThan(16000);
        expect(s.speed, `${demo.id} @${t} speed`).toBeGreaterThanOrEqual(0);
        expect(s.throttle).toBeGreaterThanOrEqual(0);
        expect(s.throttle).toBeLessThanOrEqual(1);
        expect(['Z', 'X']).toContain(s.mode);
      }
    }
  });

  it('keeps every frame inside its own duration, and in order', () => {
    for (const demo of DEMOS) {
      let last = -1;
      for (const f of demo.frames) {
        expect(f.t, demo.id).toBeGreaterThanOrEqual(last);
        expect(f.t, demo.id).toBeLessThanOrEqual(demo.duration);
        last = f.t;
      }
    }
  });

  it('starts a race start in neutral, standing still, and ends it moving', () => {
    const demo = byId('start');
    const t0 = stateAt(demo, 0);
    expect(t0.gear).toBe(0);
    expect(t0.speed).toBe(0);
    expect(stateAt(demo, demo.duration).speed).toBeGreaterThan(150);
  });

  it('only ever shifts up through the box on the start, one gear at a time', () => {
    const gears = byId('start').frames.map((f) => f.gear).filter((g) => g !== undefined);
    for (let i = 1; i < gears.length; i += 1) {
      const step = gears[i] - gears[i - 1];
      expect(Math.abs(step), `${gears[i - 1]} -> ${gears[i]}`).toBeLessThanOrEqual(1);
    }
  });

  it('flattens the wings only while the override is on', () => {
    // X-mode is a straight-line state. If the demo ever left the wings
    // flat into the braking zone it would be teaching the wrong thing.
    const demo = byId('overtake');
    for (let t = 0; t <= demo.duration; t += 0.1) {
      const s = stateAt(demo, t);
      if (s.mode === 'X') expect(s.throttle, `@${t.toFixed(1)}`).toBeGreaterThan(0.5);
    }
    expect(stateAt(demo, demo.duration).mode).toBe('Z');
  });

  it('puts the overtake back on the race strategy by the end', () => {
    const demo = byId('overtake');
    expect(stateAt(demo, 2).strategy).toBe(0);
    expect(stateAt(demo, 5).strategy).toBe(2);
    expect(stateAt(demo, demo.duration).strategy).toBe(0);
  });
});

describe('the shift strip during a demo', () => {
  const topLampTone = (rpm) => {
    const n = litLamps(rpm, 13);
    return n === 0 ? null : lampTone(n - 1, 13);
  };

  it('runs the strip into the red before every upshift', () => {
    // The demos used to top out at 12 600 against a 15 000 limit — 84%,
    // under the 88% where the red band begins — so not one red lamp lit
    // at any point in either sequence, at exactly the moments the revs
    // are highest. A driver takes an upshift ON the limiter, and that is
    // also the only thing that puts this strip into its red.
    for (const demo of DEMOS) {
      let red = false;
      let flashed = false;
      for (let t = 0; t <= demo.duration; t += 0.05) {
        const { rpm } = stateAt(demo, t);
        if (topLampTone(rpm) === 'c') red = true;
        if (atRevLimit(rpm)) flashed = true;
      }
      expect(red, `${demo.id} never shows a red lamp`).toBe(true);
      expect(flashed, `${demo.id} never reaches the limiter`).toBe(true);
    }
  });

  it('empties the strip on every upshift', () => {
    // Red, flash, drop, fill again. If the revs never came back down
    // the strip would sit at the top for the whole run and the shift
    // would not be visible in it at all.
    for (const demo of DEMOS) {
      const frames = demo.frames.filter((f) => f.gear !== undefined && f.rpm !== undefined);
      let upshifts = 0;
      for (let i = 1; i < frames.length; i += 1) {
        // Selecting first FROM NEUTRAL is not an upshift: the car is
        // standing still and the revs rise as the driver picks them up
        // against the clutch. Only shifts between gears drop them.
        if (frames[i - 1].gear < 1) continue;
        if (frames[i].gear <= frames[i - 1].gear) continue;
        // Only where the two keyframes are the shift ITSELF. A gear
        // change written across 1.4 seconds is a shift that happens
        // somewhere in between while the car accelerates, and the revs
        // either side of it legitimately go up.
        if (frames[i].t - frames[i - 1].t > 0.5) continue;
        upshifts += 1;
        expect(frames[i].rpm, `${demo.id} shift to ${frames[i].gear}`)
          .toBeLessThan(frames[i - 1].rpm);
        expect(litLamps(frames[i].rpm, 13), `${demo.id} shift to ${frames[i].gear}`)
          .toBeLessThan(litLamps(frames[i - 1].rpm, 13));
      }
      expect(upshifts, `${demo.id} upshifts`).toBeGreaterThan(0);
    }
  });

  it('keeps the strip dark on the grid, before the start', () => {
    // Idling in neutral is not a moment for thirteen lit lamps.
    expect(litLamps(stateAt(DEMOS[0], 0).rpm, 13)).toBe(0);
  });
});
