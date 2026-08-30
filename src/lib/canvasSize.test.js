import { describe, expect, it } from 'vitest';
import { needsResize } from './canvasSize.js';

// The regression these guard is specific: at a fractional device pixel
// ratio the old check was true on every frame, which re-framed the camera
// continuously and made zooming impossible. A test that only ever uses
// ratio 1 would have passed against the broken version.

describe('needsResize', () => {
  it('is false once the backing store matches, at ratio 1', () => {
    expect(needsResize(1090, 682, 1090, 682, 1)).toBe(false);
  });

  it('is false at a fractional ratio, where the store is floored', () => {
    // 1090 * 1.25 = 1362.5, and setSize stores 1362. Comparing against
    // 1362.5 is what made this true forever.
    expect(needsResize(1362, 852, 1090, 682, 1.25)).toBe(false);
  });

  it('is false at every ratio a browser is likely to report', () => {
    for (const pr of [1, 1.25, 1.5, 1.75, 2, 2.625, 3]) {
      for (const [w, h] of [[1090, 682], [391, 244], [1439, 899], [1, 1]]) {
        const stored = [Math.floor(w * pr), Math.floor(h * pr)];
        expect(needsResize(stored[0], stored[1], w, h, pr), `ratio ${pr} at ${w}x${h}`)
          .toBe(false);
      }
    }
  });

  it('is true when the element has actually been resized', () => {
    expect(needsResize(1362, 852, 900, 682, 1.25)).toBe(true);
    expect(needsResize(1362, 852, 1090, 500, 1.25)).toBe(true);
  });

  it('is true when the pixel ratio changes under a fixed element size', () => {
    // Dragging a window between a retina and a non-retina display.
    expect(needsResize(1090, 682, 1090, 682, 2)).toBe(true);
  });
});
