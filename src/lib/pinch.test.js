import { describe, it, expect } from 'vitest';
import { pinchRadius, spread } from './pinch.js';

const MIN = 2.4;
const MAX = 15;

describe('spread', () => {
  it('measures the gap between two fingers', () => {
    expect(spread({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('pinchRadius', () => {
  it('pulls the camera in as the fingers move apart', () => {
    expect(pinchRadius(8, 100, 200, MIN, MAX)).toBe(4);
  });

  it('pushes it out as they come together', () => {
    expect(pinchRadius(4, 200, 100, MIN, MAX)).toBe(8);
  });

  it('is anchored, so a pinch out and back lands where it started', () => {
    // The reason this is a pure function of the START distance rather
    // than an accumulation: accumulating drifts, and it drifts most
    // while somebody is fiddling to frame a part.
    const start = 7;
    const out = pinchRadius(start, 120, 260, MIN, MAX);
    expect(out).not.toBe(start);
    expect(pinchRadius(start, 120, 120, MIN, MAX)).toBe(start);
  });

  it('clamps to the zoom limits', () => {
    expect(pinchRadius(8, 100, 100000, MIN, MAX)).toBe(MIN);
    expect(pinchRadius(8, 100000, 100, MIN, MAX)).toBe(MAX);
  });

  it('holds still rather than dividing by zero when fingers coincide', () => {
    expect(pinchRadius(6, 0, 100, MIN, MAX)).toBe(6);
    expect(pinchRadius(6, 100, 0, MIN, MAX)).toBe(6);
  });
});
