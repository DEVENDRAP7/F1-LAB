import { describe as suite, expect, it } from 'vitest';
import {
  BUTTONS, CONTROL_KIND, FIXTURES, IDLE_RPM, LIGHTS_FROM, REV_LIMIT, ROTARIES,
  LIMITER_HOLD_S, LIMITER_SETTLE_S, REST_RPM, RPM_PER_SECOND,
  RPM_AFTER_DOWNSHIFT, RPM_AFTER_UPSHIFT, STATUS_LAMPS, WHEEL_DEFAULT,
  atRevLimit, describe, initialPositions, litLamps, manualRpm,
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

suite('the shift strip', () => {
  it('stays dark for most of the rev range', () => {
    // A lamp that is on all the time is not a signal. This is the bug
    // the strip shipped with: thirteen circles painted permanently
    // green-amber-red, telling you nothing at any moment.
    expect(litLamps(0, 13)).toBe(0);
    expect(litLamps(REV_LIMIT * 0.5, 13)).toBe(0);
    expect(litLamps(REV_LIMIT * LIGHTS_FROM, 13)).toBe(0);
  });

  it('fills from the first lamp to the last, and never past either end', () => {
    let previous = 0;
    for (let rpm = 0; rpm <= REV_LIMIT * 1.2; rpm += 100) {
      const n = litLamps(rpm, 13);
      expect(n, `${rpm} rpm`).toBeGreaterThanOrEqual(previous);
      expect(n, `${rpm} rpm`).toBeGreaterThanOrEqual(0);
      expect(n, `${rpm} rpm`).toBeLessThanOrEqual(13);
      previous = n;
    }
    expect(litLamps(REV_LIMIT, 13)).toBe(13);
  });

  it('lights the first lamp as soon as the range is entered', () => {
    expect(litLamps(REV_LIMIT * LIGHTS_FROM + 1, 13)).toBe(1);
  });

  it('flashes only at the top of the range', () => {
    expect(atRevLimit(REV_LIMIT)).toBe(true);
    expect(atRevLimit(REV_LIMIT * 0.9)).toBe(false);
    expect(atRevLimit(IDLE_RPM)).toBe(false);
  });

  it('drops the revs on an upshift and raises them on a downshift', () => {
    // Which is what empties the strip and fills it again — the whole
    // reason the lamps are worth drawing.
    expect(RPM_AFTER_UPSHIFT).toBeLessThan(RPM_AFTER_DOWNSHIFT);
    expect(litLamps(RPM_AFTER_UPSHIFT, 13))
      .toBeLessThan(litLamps(RPM_AFTER_DOWNSHIFT, 13));
    expect(IDLE_RPM).toBeLessThan(REV_LIMIT * LIGHTS_FROM);
  });

  it('gives every status lamp an id the wheel can actually be put into', () => {
    const reachable = new Set([...BUTTONS.map((b) => b.id), 'neutral']);
    for (const lamp of STATUS_LAMPS) {
      expect(reachable.has(lamp.id), lamp.id).toBe(true);
      expect(lamp.text, lamp.id).toBeTruthy();
    }
  });
});

suite('the manual rev model', () => {
  it('climbs, sits on the limiter, then lifts off it', () => {
    const from = RPM_AFTER_UPSHIFT;
    expect(manualRpm(from, 0).rpm).toBe(from);
    const rampS = (REV_LIMIT - from) / RPM_PER_SECOND;
    expect(manualRpm(from, rampS / 2).rpm).toBeGreaterThan(from);
    expect(manualRpm(from, rampS).rpm).toBe(REV_LIMIT);
    expect(manualRpm(from, rampS + 1).rpm).toBe(REV_LIMIT);
    expect(manualRpm(from, rampS + 10).rpm).toBe(REST_RPM);
  });

  it('never leaves the strip flashing for ever', () => {
    // The ramp used to end AT the limiter and stay there, so a page left
    // open sat with thirteen lamps flashing blue indefinitely — wrong,
    // because nobody holds a car on the limiter, and a permanent
    // animation on a page that is mostly charts.
    const { rpm, done } = manualRpm(RPM_AFTER_UPSHIFT, 60);
    expect(done).toBe(true);
    expect(atRevLimit(rpm)).toBe(false);
    // ...but it should still come to rest with the strip nearly full.
    expect(litLamps(rpm, 13)).toBeGreaterThanOrEqual(11);
  });

  it('reports done exactly once it has settled, so the loop can stop', () => {
    const from = RPM_AFTER_UPSHIFT;
    const total = (REV_LIMIT - from) / RPM_PER_SECOND + LIMITER_HOLD_S + LIMITER_SETTLE_S;
    // Not tested at exactly `total`: the boundary is a float division
    // that lands a few ulps under 1, and a frame either side is what
    // the loop actually samples anyway.
    expect(manualRpm(from, total - 0.05).done).toBe(false);
    expect(manualRpm(from, total + 0.05).done).toBe(true);
  });

  it('does flash on the way, or the limiter would never be seen', () => {
    const from = RPM_AFTER_UPSHIFT;
    const rampS = (REV_LIMIT - from) / RPM_PER_SECOND;
    expect(atRevLimit(manualRpm(from, rampS + 1).rpm)).toBe(true);
  });
});
