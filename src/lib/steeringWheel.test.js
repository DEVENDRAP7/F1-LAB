import { describe as suite, expect, it } from 'vitest';
import {
  BUTTONS, CONTROL_KIND, FIXTURES, ROTARIES, WHEEL_DEFAULT,
  describe, initialPositions,
} from './steeringWheel.js';

const everyControl = [...BUTTONS, ...FIXTURES, ...ROTARIES];

suite('the wheel', () => {
  it('gives every control a unique id', () => {
    const ids = everyControl.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every control a name, an explanation and a known kind', () => {
    for (const c of everyControl) {
      expect(c.name, c.id).toBeTruthy();
      expect(c.text, c.id).toBeTruthy();
      expect(CONTROL_KIND[c.kind], `${c.id}: unknown kind ${c.kind}`).toBeTruthy();
    }
  });

  it('explains every position of every rotary', () => {
    for (const rotary of ROTARIES) {
      expect(rotary.positions.length, rotary.id).toBeGreaterThan(1);
      for (const p of rotary.positions) {
        expect(p.label, rotary.id).toBeTruthy();
        expect(p.text, `${rotary.id} ${p.label}`).toBeTruthy();
      }
    }
  });

  it('starts every rotary on a position that exists', () => {
    const start = initialPositions();
    for (const rotary of ROTARIES) {
      expect(start[rotary.id], rotary.id).toBeGreaterThanOrEqual(0);
      expect(start[rotary.id], rotary.id).toBeLessThan(rotary.positions.length);
    }
  });

  it('places every drawn control inside the viewBox the component uses', () => {
    // viewBox="0 0 900 620". Anything outside it is invisible and
    // unreachable, which no test of the data alone would otherwise catch.
    for (const c of [...BUTTONS, ...ROTARIES]) {
      expect(c.x ?? c.cx, `${c.id} x`).toBeGreaterThanOrEqual(0);
      expect(c.x ?? c.cx, `${c.id} x`).toBeLessThanOrEqual(900);
      expect(c.y ?? c.cy, `${c.id} y`).toBeGreaterThanOrEqual(0);
      expect(c.y ?? c.cy, `${c.id} y`).toBeLessThanOrEqual(620);
    }
  });

  it('is a 2026 wheel, not a pre-2026 one', () => {
    const ids = BUTTONS.map((b) => b.id);
    // Active aero replaced DRS, and override replaced it as the
    // overtaking tool. A DRS button here would be wrong.
    expect(ids).toContain('aero');
    expect(ids).toContain('override');
    expect(ids).not.toContain('drs');
  });
});

suite('describe', () => {
  it('names a button, a rotary and one position of a rotary', () => {
    expect(describe('btn:limiter').name).toBe('Pit lane speed limiter');
    expect(describe('rot:braking').name).toBe('Engine braking');
    expect(describe('pos:strategy:0').name).toBe('Strategy mode · RACE');
    expect(describe('pos:strategy:0').kind).toBe('position');
  });

  it('falls back to the default for nothing, or for anything unknown', () => {
    expect(describe(null)).toBe(WHEEL_DEFAULT);
    expect(describe('btn:nope')).toBe(WHEEL_DEFAULT);
    expect(describe('rot:nope')).toBe(WHEEL_DEFAULT);
    expect(describe('pos:strategy:99')).toBe(WHEEL_DEFAULT);
    expect(describe('gibberish')).toBe(WHEEL_DEFAULT);
  });
});
