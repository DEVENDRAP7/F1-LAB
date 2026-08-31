import { describe, expect, it } from 'vitest';
import { CONTROLS, CONTROL_KIND, WHEEL_DEFAULT, controlInfo } from './steeringWheel.js';

describe('CONTROLS', () => {
  it('gives every control a unique id', () => {
    const ids = CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every control a name, an explanation and a known kind', () => {
    for (const c of CONTROLS) {
      expect(c.name, c.id).toBeTruthy();
      expect(c.text, c.id).toBeTruthy();
      expect(CONTROL_KIND[c.kind], `${c.id}: unknown kind ${c.kind}`).toBeTruthy();
    }
  });

  it('places every control inside the drawing the component uses', () => {
    // The SVG is viewBox="0 0 420 320". A control positioned outside it
    // is invisible and unreachable, which no test of the data alone
    // would otherwise catch.
    for (const c of CONTROLS) {
      expect(c.x, `${c.id} x`).toBeGreaterThanOrEqual(0);
      expect(c.x, `${c.id} x`).toBeLessThanOrEqual(420);
      expect(c.y, `${c.id} y`).toBeGreaterThanOrEqual(0);
      expect(c.y, `${c.id} y`).toBeLessThanOrEqual(320);
    }
  });

  it('carries the 2026-specific controls, not a pre-2026 wheel', () => {
    const ids = CONTROLS.map((c) => c.id);
    // Active aero replaced DRS for 2026 and override replaced it as the
    // overtaking tool; a wheel here with a DRS button would be wrong.
    expect(ids).toContain('aero');
    expect(ids).toContain('override');
    expect(ids).not.toContain('drs');
  });
});

describe('controlInfo', () => {
  it('looks up a known control', () => {
    expect(controlInfo('limiter').name).toBe('Pit lane speed limiter');
  });

  it('falls back to the default for nothing selected or an unknown id', () => {
    expect(controlInfo(null)).toBe(WHEEL_DEFAULT);
    expect(controlInfo(undefined)).toBe(WHEEL_DEFAULT);
    expect(controlInfo('not-a-control')).toBe(WHEEL_DEFAULT);
  });
});
