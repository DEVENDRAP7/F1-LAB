import { describe, expect, it } from 'vitest';
import {
  GRIP_LIMITED_TOLERANCE_PCT,
  cornerModel,
  impliedGripG,
  sustainedCurvature,
} from './cornerModel.js';

const G = 9.80665;

// A turn occupying samples 10..20 of a 100-sample lap, at a constant
// radius, taken at exactly the speed that radius supports at `gripG`.
function turn(number, { start = 10, end = 20, radiusM = 100, gripG = 3 } = {}) {
  const v = Math.sqrt(gripG * G * radiusM);
  return {
    turn: {
      number,
      startIndex: start,
      endIndex: end,
      apexIndex: Math.round((start + end) / 2),
      minSpeedKph: v * 3.6,
      direction: 'left',
    },
    radiusM,
  };
}

function curvatureFor(specs, n = 100) {
  const curvature = new Array(n).fill(0);
  for (const { turn: t, radiusM } of specs) {
    for (let i = t.startIndex; i <= t.endIndex; i += 1) curvature[i] = 1 / radiusM;
  }
  return curvature;
}

describe('sustainedCurvature', () => {
  it('reads the curvature the turn actually holds', () => {
    const spec = turn(1, { radiusM: 50 });
    const curvature = curvatureFor([spec]);
    expect(sustainedCurvature(spec.turn, curvature)).toBeCloseTo(1 / 50, 10);
  });

  it('ignores a single sharper sample, which is usually the entry transition', () => {
    const spec = turn(1, { radiusM: 100 });
    const curvature = curvatureFor([spec]);
    curvature[spec.turn.startIndex] = 1 / 5; // one very tight sample
    // The 90th percentile over 11 samples steps past the outlier.
    expect(sustainedCurvature(spec.turn, curvature)).toBeCloseTo(1 / 100, 10);
  });

  it('wraps a turn that spans the start/finish line', () => {
    const t = { number: 1, startIndex: 95, endIndex: 4, minSpeedKph: 100, direction: 'left' };
    const curvature = new Array(100).fill(0);
    for (const i of [95, 96, 97, 98, 99, 0, 1, 2, 3, 4]) curvature[i] = 1 / 80;
    expect(sustainedCurvature(t, curvature)).toBeCloseTo(1 / 80, 10);
  });

  it('is zero rather than undefined when there is no curvature to read', () => {
    expect(sustainedCurvature({ startIndex: 0, endIndex: 0 }, [])).toBe(0);
  });
});

describe('impliedGripG', () => {
  it('recovers the grip every corner was taken at', () => {
    const specs = [turn(1, { radiusM: 60 }), turn(2, { start: 40, end: 50, radiusM: 200 })];
    const grip = impliedGripG(specs.map((s) => s.turn), curvatureFor(specs));
    expect(grip).toBeCloseTo(3, 6);
  });

  it('takes the median, so one compromised corner does not set the lap', () => {
    const specs = [
      turn(1, { radiusM: 60 }),
      turn(2, { start: 30, end: 40, radiusM: 60 }),
      turn(3, { start: 60, end: 70, radiusM: 60 }),
    ];
    // Third corner taken far below the grip the other two show.
    specs[2].turn.minSpeedKph *= 0.5;
    const grip = impliedGripG(specs.map((s) => s.turn), curvatureFor(specs));
    expect(grip).toBeCloseTo(3, 6);
  });

  it('is null rather than zero when no turn has a radius', () => {
    expect(impliedGripG([], [])).toBeNull();
  });
});

describe('cornerModel', () => {
  it('reproduces the speed a corner was taken at, at its own grip', () => {
    const spec = turn(1, { radiusM: 120, gripG: 2.8 });
    const model = cornerModel([spec.turn], curvatureFor([spec]), 2.8);
    const row = model.rows[0];
    expect(row.radiusM).toBeCloseTo(120, 6);
    expect(row.modelKph).toBeCloseTo(row.measuredKph, 6);
    expect(row.deltaPct).toBeCloseTo(0, 6);
    expect(row.gripLimited).toBe(true);
    expect(model.medianAbsErrorPct).toBeCloseTo(0, 6);
  });

  it('a corner taken below the model reads as a negative delta', () => {
    const spec = turn(1, { radiusM: 120, gripG: 2.8 });
    spec.turn.minSpeedKph *= 0.8;
    const model = cornerModel([spec.turn], curvatureFor([spec]), 2.8);
    expect(model.rows[0].deltaPct).toBeCloseTo(-20, 6);
    expect(model.rows[0].gripLimited).toBe(false);
    expect(model.turnsGripLimited).toBe(0);
  });

  it('more grip predicts more speed, by the square root of the ratio', () => {
    const spec = turn(1, { radiusM: 120, gripG: 2.8 });
    const curvature = curvatureFor([spec]);
    const base = cornerModel([spec.turn], curvature, 2.8).rows[0].modelKph;
    const doubled = cornerModel([spec.turn], curvature, 5.6).rows[0].modelKph;
    expect(doubled / base).toBeCloseTo(Math.SQRT2, 6);
  });

  it('counts a turn as grip-limited only inside the stated tolerance', () => {
    const spec = turn(1, { radiusM: 120, gripG: 2.8 });
    spec.turn.minSpeedKph *= 1 - (GRIP_LIMITED_TOLERANCE_PCT + 1) / 100;
    expect(cornerModel([spec.turn], curvatureFor([spec]), 2.8).turnsGripLimited).toBe(0);
    spec.turn.minSpeedKph = Math.sqrt(2.8 * G * 120) * 3.6
      * (1 - (GRIP_LIMITED_TOLERANCE_PCT - 1) / 100);
    expect(cornerModel([spec.turn], curvatureFor([spec]), 2.8).turnsGripLimited).toBe(1);
  });

  it('a straight section carries no radius and is modelled as nothing', () => {
    const t = { number: 1, startIndex: 5, endIndex: 8, minSpeedKph: 300, direction: 'left' };
    const model = cornerModel([t], new Array(100).fill(0), 3);
    expect(model.rows[0].radiusM).toBeNull();
    expect(model.rows[0].modelKph).toBeNull();
    expect(model.turnsModelled).toBe(0);
    expect(model.medianAbsErrorPct).toBeNull();
  });
});


describe('the model has no engine', () => {
  it('makes no grip claim where the geometry allows more than the car reached', () => {
    // A 480 m kink at 2.7g supports about 400 km/h. No car here does that.
    const spec = turn(1, { radiusM: 480, gripG: 2.7 });
    spec.turn.minSpeedKph = 300;
    const model = cornerModel([spec.turn], curvatureFor([spec]), 2.7, { topSpeedKph: 320 });
    const row = model.rows[0];
    expect(row.powerLimited).toBe(true);
    expect(row.modelKph).toBeNull();
    expect(row.deltaPct).toBeNull();
    expect(row.geometryKph).toBeGreaterThan(320);
    expect(model.turnsPowerLimited).toBe(1);
    expect(model.turnsModelled).toBe(0);
  });

  it('leaves those corners out of the error rather than counting them as misses', () => {
    const kink = turn(1, { radiusM: 480, gripG: 2.7 });
    kink.turn.minSpeedKph = 300;
    const real = turn(2, { start: 40, end: 50, radiusM: 80, gripG: 2.7 });
    const specs = [kink, real];
    const model = cornerModel(
      specs.map((s) => s.turn), curvatureFor(specs), 2.7, { topSpeedKph: 320 },
    );
    expect(model.turnsModelled).toBe(1);
    expect(model.medianAbsErrorPct).toBeCloseTo(0, 6);
  });

  it('models everything when no top speed is given', () => {
    const spec = turn(1, { radiusM: 480, gripG: 2.7 });
    const model = cornerModel([spec.turn], curvatureFor([spec]), 2.7);
    expect(model.rows[0].powerLimited).toBe(false);
    expect(model.turnsModelled).toBe(1);
  });
});
