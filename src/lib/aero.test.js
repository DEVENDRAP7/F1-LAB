import { describe, expect, it } from 'vitest';
import { accelerationTrace, lateralEnvelope, peaks } from './aero.js';

/**
 * A circle of known radius at constant speed. Lateral acceleration must
 * come out at exactly v²/R, which is the one case where the right answer
 * is known independently of the implementation.
 */
function circle({ radiusM = 200, speedKph = 180, ds = 2 }) {
  const circumference = 2 * Math.PI * radiusM;
  const n = Math.round(circumference / ds);
  const x = [];
  const y = [];
  const speed = [];
  for (let i = 0; i < n; i += 1) {
    const theta = (2 * Math.PI * i) / n;
    x.push(radiusM * Math.cos(theta));
    y.push(radiusM * Math.sin(theta));
    speed.push(speedKph);
  }
  return { x, y, speed };
}

describe('accelerationTrace', () => {
  it('recovers v squared over R on a known circle', () => {
    const radiusM = 200;
    const speedKph = 180;
    const v = speedKph / 3.6;
    const expectedG = (v * v) / radiusM / 9.80665;

    const trace = accelerationTrace(circle({ radiusM, speedKph }));
    const mid = Math.floor(trace.lateralG.length / 2);
    expect(trace.lateralG[mid]).toBeCloseTo(expectedG, 2);
  });

  it('reports no longitudinal g at constant speed', () => {
    const trace = accelerationTrace(circle({}));
    const mid = Math.floor(trace.longitudinalG.length / 2);
    expect(Math.abs(trace.longitudinalG[mid])).toBeLessThan(0.01);
  });

  it('reports no lateral g on a straight', () => {
    const n = 200;
    const x = Array.from({ length: n }, (_, i) => i * 2);
    const y = new Array(n).fill(0);
    const speed = new Array(n).fill(250);
    const trace = accelerationTrace({ x, y, speed });
    const mid = Math.floor(n / 2);
    expect(Math.abs(trace.lateralG[mid])).toBeLessThan(0.01);
  });

  it('scales with the square of speed, which is the aerodynamic point', () => {
    const slow = accelerationTrace(circle({ radiusM: 200, speedKph: 100 }));
    const fast = accelerationTrace(circle({ radiusM: 200, speedKph: 200 }));
    const mid = Math.floor(slow.lateralG.length / 2);
    // Double the speed on the same radius is four times the lateral g.
    expect(fast.lateralG[mid] / slow.lateralG[mid]).toBeCloseTo(4, 1);
  });

  it('measures braking as negative longitudinal g', () => {
    const n = 300;
    const x = Array.from({ length: n }, (_, i) => i * 2);
    const y = new Array(n).fill(0);
    // 300 km/h decaying to 100 over the length of the straight.
    const speed = Array.from({ length: n }, (_, i) => 300 - (200 * i) / (n - 1));
    const trace = accelerationTrace({ x, y, speed });
    const mid = Math.floor(n / 2);
    expect(trace.longitudinalG[mid]).toBeLessThan(0);
  });

  it('returns empty rather than throwing on a stub lap', () => {
    expect(accelerationTrace({ x: [1], y: [1], speed: [1] }).lateralG).toEqual([]);
  });
});

describe('lateralEnvelope', () => {
  it('bins by speed and reports the sample count behind each point', () => {
    const trace = accelerationTrace(circle({ radiusM: 200, speedKph: 180 }));
    const env = lateralEnvelope(trace);
    expect(env.length).toBeGreaterThan(0);
    for (const point of env) {
      expect(point.samples).toBeGreaterThanOrEqual(8);
      expect(point.lateralG).toBeGreaterThan(0);
    }
  });

  it('drops a bin with too few samples rather than drawing from almost nothing', () => {
    const trace = accelerationTrace(circle({ radiusM: 200, speedKph: 180 }));
    const env = lateralEnvelope(trace, { minSamples: 100000 });
    expect(env).toEqual([]);
  });
});

describe('peaks', () => {
  it('reports braking as a positive magnitude and finds top speed', () => {
    const n = 300;
    const x = Array.from({ length: n }, (_, i) => i * 2);
    const y = new Array(n).fill(0);
    const speed = Array.from({ length: n }, (_, i) => 300 - (200 * i) / (n - 1));
    const p = peaks(accelerationTrace({ x, y, speed }));
    expect(p.peakBrakingG).toBeGreaterThan(0);
    expect(p.topSpeedKph).toBeCloseTo(300, 0);
  });
});

describe('signed lateral g', () => {
  it('keeps the turn direction so a g-g plot is a full circle', () => {
    const right = accelerationTrace(circle({ radiusM: 200, speedKph: 180 }));
    const mid = Math.floor(right.lateralG.length / 2);
    const sign = Math.sign(right.lateralG[mid]);
    expect(Math.abs(sign)).toBe(1);

    // The mirrored path must produce the opposite sign.
    const c = circle({ radiusM: 200, speedKph: 180 });
    const mirrored = accelerationTrace({ x: c.x, y: c.y.map((v) => -v), speed: c.speed });
    expect(Math.sign(mirrored.lateralG[mid])).toBe(-sign);
  });

  it('still reports peak lateral g as a magnitude', () => {
    const c = circle({ radiusM: 200, speedKph: 180 });
    const mirrored = accelerationTrace({ x: c.x, y: c.y.map((v) => -v), speed: c.speed });
    expect(peaks(mirrored).peakLateralG).toBeGreaterThan(0);
  });
});

describe('coarsely sampled paths', () => {
  // The real defect this guards against. Position is published at about
  // 3.7 Hz and then interpolated onto a 2 m grid, so the path between two
  // published fixes is a straight segment with a kink at each end.
  // Differentiating that over 2 m measures the kink, not the corner: on
  // Zandvoort's fastest laps it produced peaks of 18-24g lateral, which no
  // Formula 1 car generates.
  function chordSampledCircle({ radiusM, speedKph, fixSpacingM, ds = 2 }) {
    const circumference = 2 * Math.PI * radiusM;
    const fixes = Math.round(circumference / fixSpacingM);
    const corners = Array.from({ length: fixes }, (_, i) => {
      const t = (i / fixes) * 2 * Math.PI;
      return [radiusM * Math.cos(t), radiusM * Math.sin(t)];
    });

    // Walk the polygon in ds steps — exactly what linear interpolation
    // onto a uniform grid produces.
    const x = [];
    const y = [];
    for (let i = 0; i < corners.length; i += 1) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % corners.length];
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += ds) {
        const f = d / len;
        x.push(ax + (bx - ax) * f);
        y.push(ay + (by - ay) * f);
      }
    }
    return { x, y, speed: new Array(x.length).fill(speedKph) };
  }

  it('recovers the true radius through interpolation kinks', () => {
    const trace = accelerationTrace(
      chordSampledCircle({ radiusM: 150, speedKph: 200, fixSpacingM: 20 }),
    );
    const v = 200 / 3.6;
    const expected = (v * v) / 150 / 9.80665;
    expect(peaks(trace).peakLateralG).toBeGreaterThan(expected * 0.8);
    // The number that matters: no sample invents grip the car never had.
    expect(peaks(trace).peakLateralG).toBeLessThan(expected * 1.3);
  });

  it('stays near zero on a straight carrying the feed quantisation', () => {
    const n = 600;
    const x = Array.from({ length: n }, (_, i) => i * 2);
    // Position is published to 0.1 m, so a straight is never perfectly
    // straight. Deterministic pseudo-noise at exactly that amplitude.
    let seed = 7;
    const y = Array.from({ length: n }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return ((seed / 2147483648) - 0.5) * 0.2;
    });
    const trace = accelerationTrace({ x, y, speed: new Array(n).fill(300) });
    // At 300 km/h even a centimetre of drift over the window is real
    // curvature, so this is a bound on noise amplification, not a claim
    // that the answer is zero.
    expect(peaks(trace).peakLateralG).toBeLessThan(1.5);
  });
});
