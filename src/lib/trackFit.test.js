import { describe, expect, it } from 'vitest';
import { extentOf, fitBox, MAX_ASPECT } from './trackFit.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
const tall = [[0, 0], [50, 0], [50, 200], [0, 200]];
const wide = [[0, 0], [200, 0], [200, 100], [0, 100]]; // 2:1, at the clamp

describe('extentOf', () => {
  it('covers a single set of points', () => {
    expect(extentOf(square)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });

  it('covers every set it is given, which is how a driven lap stays in frame', () => {
    // A lap that runs wide of the outline must not be cropped out.
    const lap = [[-20, 50], [130, 50]];
    expect(extentOf(square, lap)).toEqual({ minX: -20, minY: 0, maxX: 130, maxY: 100 });
  });

  it('ignores points with a missing or non-finite coordinate', () => {
    expect(extentOf([[0, 0], [10, 10], [NaN, 5], null, [undefined, 2]]))
      .toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('returns null when there is nothing to draw', () => {
    expect(extentOf([])).toBeNull();
    expect(extentOf(undefined)).toBeNull();
  });
});

describe('fitBox', () => {
  it('gives a square track a square box', () => {
    const box = fitBox(extentOf(square), { long: 640 });
    expect(box.width).toBe(640);
    expect(box.height).toBe(640);
  });

  it('gives a tall track a tall box rather than padding a square one', () => {
    const box = fitBox(extentOf(tall), { long: 640 });
    expect(box.height).toBe(640);
    expect(box.width).toBe(320);
  });

  it('gives a wide track a wide box', () => {
    const box = fitBox(extentOf(wide), { long: 640 });
    expect(box.width).toBe(640);
    expect(box.height).toBe(320);
  });

  it('clamps an extreme aspect so corner markers still fit', () => {
    const ribbon = [[0, 0], [1000, 0], [1000, 20], [0, 20]]; // 50:1
    const box = fitBox(extentOf(ribbon), { long: 640 });
    expect(box.width / box.height).toBeCloseTo(MAX_ASPECT, 5);
  });

  it('scales both axes by the same factor', () => {
    // Anything else redraws the circuit as a different shape.
    const box = fitBox(extentOf(tall), { long: 640, pad: 20 });
    const [ax, ay] = box.project([0, 0]);
    const [bx, by] = box.project([50, 200]);
    expect(Math.abs(bx - ax) / 50).toBeCloseTo(Math.abs(by - ay) / 200, 6);
  });

  it('keeps every point inside the box, padding included', () => {
    for (const [name, pts] of [['square', square], ['tall', tall], ['wide', wide]]) {
      const box = fitBox(extentOf(pts), { long: 640, pad: 28 });
      for (const p of pts) {
        const [x, y] = box.project(p);
        expect(x, name).toBeGreaterThanOrEqual(-0.001);
        expect(y, name).toBeGreaterThanOrEqual(-0.001);
        expect(x, name).toBeLessThanOrEqual(box.width + 0.001);
        expect(y, name).toBeLessThanOrEqual(box.height + 0.001);
      }
    }
  });

  it('fills the box it was given, which is the whole point', () => {
    const box = fitBox(extentOf(tall), { long: 640, pad: 28 });
    const ys = tall.map((p) => box.project(p)[1]);
    const used = Math.max(...ys) - Math.min(...ys);
    // The long axis should use everything but the padding.
    expect(used).toBeCloseTo(640 - 28 * 2, 0);
  });

  it('flips y so north is up', () => {
    const box = fitBox(extentOf(square), { long: 640 });
    expect(box.project([0, 100])[1]).toBeLessThan(box.project([0, 0])[1]);
  });

  it('survives a track with no extent in one axis', () => {
    const box = fitBox(extentOf([[5, 5], [5, 5]]), { long: 640 });
    expect(Number.isFinite(box.project([5, 5])[0])).toBe(true);
  });

  it('returns null for nothing to draw', () => {
    expect(fitBox(null)).toBeNull();
  });
});
