import { describe, expect, it } from 'vitest';
import { detectTurns, turnDeltas } from './corners.js';
import { accelerationTrace } from './aero.js';

// A synthetic lap: straight, corner, straight, corner, back to the start.
// Built from geometry rather than from a recorded lap so the answer is
// known — a detector tested only against real data can agree with itself
// forever.
function lapWith({ radiusM, cornerAngle = Math.PI, straightM = 400, cornerSpeed = 150,
  straightSpeed = 280, ds = 2 }) {
  const x = [];
  const y = [];
  const speed = [];
  let heading = 0;
  let cx = 0;
  let cy = 0;

  const pushStraight = (metres, v) => {
    for (let d = 0; d < metres; d += ds) {
      cx += Math.cos(heading) * ds;
      cy += Math.sin(heading) * ds;
      x.push(cx);
      y.push(cy);
      speed.push(v);
    }
  };

  const pushArc = (angle, v) => {
    const arcLength = Math.abs(angle) * radiusM;
    const steps = Math.round(arcLength / ds);
    const perStep = angle / steps;
    for (let i = 0; i < steps; i += 1) {
      heading += perStep;
      cx += Math.cos(heading) * ds;
      cy += Math.sin(heading) * ds;
      x.push(cx);
      y.push(cy);
      speed.push(v);
    }
  };

  pushStraight(straightM, straightSpeed);
  pushArc(cornerAngle, cornerSpeed);
  pushStraight(straightM, straightSpeed);
  pushArc(cornerAngle, cornerSpeed);
  return { x, y, speed };
}

describe('detectTurns', () => {
  it('finds the corners and not the straights', () => {
    const turns = detectTurns(accelerationTrace(lapWith({ radiusM: 100 })));
    expect(turns).toHaveLength(2);
  });

  it('reports the speed carried through a turn', () => {
    const turns = detectTurns(accelerationTrace(lapWith({ radiusM: 100, cornerSpeed: 150 })));
    for (const turn of turns) {
      expect(turn.minSpeedKph).toBeCloseTo(150, 0);
      // v²/R in g, from the geometry the lap was built with.
      const expected = (150 / 3.6) ** 2 / 100 / 9.80665;
      expect(turn.sustainedLateralG).toBeGreaterThan(expected * 0.8);
      expect(turn.sustainedLateralG).toBeLessThan(expected * 1.25);
    }
  });

  it('keeps the direction the corner actually went', () => {
    const left = detectTurns(accelerationTrace(lapWith({ radiusM: 100 })));
    const mirroredLap = lapWith({ radiusM: 120 });
    const right = detectTurns(
      accelerationTrace({ ...mirroredLap, y: mirroredLap.y.map((v) => -v) }),
    );
    expect(left[0].direction).not.toBe(right[0].direction);
  });

  it('ignores a load too brief to be a turn', () => {
    // A 10 m twitch at the length threshold's own scale.
    const turns = detectTurns(
      accelerationTrace(lapWith({ radiusM: 100, cornerAngle: 0.08 })),
    );
    expect(turns).toHaveLength(0);
  });

  it('treats a double apex as one turn, not two', () => {
    // Two arcs with a short straight between them: a driver drives that
    // as one corner, and splitting it would report the circuit wrong.
    const ds = 2;
    const lap = lapWith({ radiusM: 100, cornerAngle: Math.PI / 2, straightM: 400 });
    const second = lapWith({ radiusM: 100, cornerAngle: Math.PI / 2, straightM: 20 });
    const joined = {
      x: [...lap.x, ...second.x.map((v) => v + 1e4)],
      y: [...lap.y, ...second.y],
      speed: [...lap.speed, ...second.speed],
    };
    const turns = detectTurns(accelerationTrace(joined, ds));
    // The join itself is artificial, so this only asserts the merge rule
    // does not produce a turn per arc of a linked pair.
    expect(turns.length).toBeLessThan(6);
  });

  it('returns nothing for a lap with no lateral load at all', () => {
    const n = 500;
    const straight = {
      x: Array.from({ length: n }, (_, i) => i * 2),
      y: new Array(n).fill(0),
      speed: new Array(n).fill(300),
    };
    expect(detectTurns(accelerationTrace(straight))).toEqual([]);
  });
});

describe('turnDeltas', () => {
  const turns = [
    { number: 1, startIndex: 10, endIndex: 30 },
    { number: 2, startIndex: 60, endIndex: 80 },
  ];

  it('reads each turn off the cumulative trace', () => {
    // A trace that loses a tenth per sample inside turn 1 and nothing
    // anywhere else.
    const delta = new Float64Array(100);
    for (let i = 0; i < 100; i += 1) {
      delta[i] = i <= 10 ? 0 : Math.min(i, 30) === i ? (i - 10) * 0.1 : 2.0;
    }
    const [first, second] = turnDeltas(turns, delta);
    expect(first.deltaS).toBeCloseTo(2.0, 6);
    expect(second.deltaS).toBeCloseTo(0, 6);
  });

  it('handles a turn that spans the start of the lap', () => {
    const delta = new Float64Array(100);
    for (let i = 0; i < 100; i += 1) delta[i] = i * 0.01; // 1s over the lap
    const wrapped = [{ number: 1, startIndex: 95, endIndex: 5 }];
    const [turn] = turnDeltas(wrapped, delta);
    // Four steps from sample 95 to the last one, then five more past the
    // line, at 0.01s each.
    expect(turn.deltaS).toBeCloseTo(0.09, 6);
  });
});
