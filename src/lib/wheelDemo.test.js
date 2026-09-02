import { describe, expect, it } from 'vitest';
import { DEMOS, channelAt, stateAt } from './wheelDemo.js';

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
