import { describe, expect, it } from 'vitest';
import {
  COAST_MIN_SPEED_KPH,
  MIN_COAST_SAMPLES,
  MIN_SPEED_SPAN_KPH,
  coastIndices,
  dragFit,
  fitLine,
} from './drag.js';

const G = 9.80665;

// A synthetic coast-down: the car lifts at `from` km/h and slows on
// a = k·v² + c alone, in a straight line, for `n` samples.
function coastDown({ n = 200, from = 320, k = 0.0004, c = 1.5 } = {}) {
  const speedKph = [];
  const longitudinalG = [];
  const lateralG = [];
  const throttle = [];
  const brake = [];
  let v = from / 3.6;
  for (let i = 0; i < n; i += 1) {
    const decel = k * v * v + c;
    speedKph.push(v * 3.6);
    longitudinalG.push(-decel / G);
    lateralG.push(0);
    throttle.push(0);
    brake.push(0);
    v -= decel * 0.05; // an arbitrary step; only the (v², a) pairs matter
  }
  return {
    trace: { speedKph, longitudinalG, lateralG, curvature: lateralG },
    channels: { throttle, brake },
  };
}

describe('fitLine', () => {
  it('recovers a line exactly', () => {
    const xs = [0, 1, 2, 3];
    const ys = xs.map((x) => 3 * x + 5);
    const fit = fitLine(xs, ys);
    expect(fit.slope).toBeCloseTo(3, 10);
    expect(fit.intercept).toBeCloseTo(5, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
  });

  it('is null when every x is the same, because no slope is determined', () => {
    expect(fitLine([2, 2, 2], [1, 2, 3])).toBeNull();
  });

  it('is null with fewer than two points', () => {
    expect(fitLine([1], [1])).toBeNull();
  });
});

describe('coastIndices', () => {
  it('takes samples that are off throttle, off brake, quick and straight', () => {
    const { trace, channels } = coastDown();
    expect(coastIndices(trace, channels).length).toBeGreaterThan(0);
  });

  it('rejects a sample with the throttle open', () => {
    const { trace, channels } = coastDown();
    channels.throttle = channels.throttle.map(() => 40);
    expect(coastIndices(trace, channels)).toEqual([]);
  });

  it('rejects a sample on the brakes', () => {
    const { trace, channels } = coastDown();
    channels.brake = channels.brake.map(() => 1);
    expect(coastIndices(trace, channels)).toEqual([]);
  });

  it('rejects a sample carrying lateral load, where the car is scrubbing speed', () => {
    const { trace, channels } = coastDown();
    trace.lateralG = trace.lateralG.map(() => 2);
    expect(coastIndices(trace, channels)).toEqual([]);
  });

  it('rejects a sample that is accelerating, which is a gradient and not drag', () => {
    const { trace, channels } = coastDown();
    trace.longitudinalG = trace.longitudinalG.map(() => 0.2);
    expect(coastIndices(trace, channels)).toEqual([]);
  });

  it('rejects slow samples, where drag is not what is slowing the car', () => {
    const { trace, channels } = coastDown();
    trace.speedKph = trace.speedKph.map(() => COAST_MIN_SPEED_KPH - 1);
    expect(coastIndices(trace, channels)).toEqual([]);
  });

  it('is empty rather than throwing when the channels are absent', () => {
    expect(coastIndices({ speedKph: [], longitudinalG: [], lateralG: [] }, {})).toEqual([]);
  });
});

describe('dragFit', () => {
  it('recovers the coefficients it was given', () => {
    const { trace, channels } = coastDown({ k: 0.0004, c: 1.5 });
    const fit = dragFit(trace, channels);
    expect(fit.available).toBe(true);
    expect(fit.k).toBeCloseTo(0.0004, 8);
    expect(fit.constantDecel).toBeCloseTo(1.5, 6);
    expect(fit.r2).toBeCloseTo(1, 8);
  });

  it('reports the deceleration drag alone accounts for at a speed', () => {
    const { trace, channels } = coastDown({ k: 0.0004, c: 1.5 });
    const fit = dragFit(trace, channels);
    // k·v² at 300 km/h = 0.0004 × (300/3.6)²
    expect(fit.dragDecelAt(300)).toBeCloseTo(0.0004 * (300 / 3.6) ** 2, 6);
  });

  it('reports where drag overtakes everything that does not scale with speed', () => {
    const { trace, channels } = coastDown({ k: 0.0004, c: 1.5 });
    const fit = dragFit(trace, channels);
    expect(fit.crossoverKph).toBeCloseTo(Math.sqrt(1.5 / 0.0004) * 3.6, 4);
  });

  it('refuses a lap with too little coasting, and says how little', () => {
    const { trace, channels } = coastDown({ n: MIN_COAST_SAMPLES - 1 });
    const fit = dragFit(trace, channels);
    expect(fit.available).toBe(false);
    expect(fit.samples).toBe(MIN_COAST_SAMPLES - 1);
    expect(fit.reason).toContain(String(MIN_COAST_SAMPLES));
  });

  it('refuses when every sample sits in the same narrow speed band', () => {
    const { trace, channels } = coastDown({ n: 300 });
    trace.speedKph = trace.speedKph.map((_, i) => 300 + (i % 2));
    const fit = dragFit(trace, channels);
    expect(fit.available).toBe(false);
    expect(fit.reason).toContain(String(MIN_SPEED_SPAN_KPH));
  });

  it('refuses a negative v² term rather than publishing it as drag', () => {
    const { trace, channels } = coastDown({ n: 300 });
    // Deceleration falling as speed rises is not drag.
    trace.longitudinalG = trace.speedKph.map((kph) => -(6 - kph / 100) / G);
    const fit = dragFit(trace, channels);
    expect(fit.available).toBe(false);
    expect(fit.reason).toContain('not drag');
  });

  it('refuses a fit that explains too little of the scatter', () => {
    const { trace, channels } = coastDown({ n: 400, k: 0.00001, c: 2 });
    // Deterministic noise far larger than the signal.
    trace.longitudinalG = trace.longitudinalG.map((g, i) => g - (i % 7) * 0.12);
    const fit = dragFit(trace, channels);
    expect(fit.available).toBe(false);
    expect(fit.reason).toMatch(/explains only|not drag/);
  });
});
