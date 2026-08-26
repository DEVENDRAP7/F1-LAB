import { describe, expect, it } from 'vitest';
import { drivingStyle } from './style.js';
import { accelerationTrace } from './aero.js';

// A lap built from geometry: two straights and two corners, with the
// pedals driven by hand so the answers are known rather than measured.
function syntheticLap({ radiusM = 100, straightM = 400, cornerSpeed = 120,
  straightSpeed = 300, ds = 2 } = {}) {
  const x = [];
  const y = [];
  const speed = [];
  const throttle = [];
  const brake = [];
  const gear = [];
  let heading = 0;
  let cx = 0;
  let cy = 0;

  const push = (v, t, b, g) => {
    cx += Math.cos(heading) * ds;
    cy += Math.sin(heading) * ds;
    x.push(cx);
    y.push(cy);
    speed.push(v);
    throttle.push(t);
    brake.push(b);
    gear.push(g);
  };

  const straight = () => {
    const steps = Math.round(straightM / ds);
    for (let i = 0; i < steps; i += 1) {
      // Full throttle down the straight, then hard on the brakes for the
      // last fifth of it.
      const braking = i > steps * 0.8;
      push(braking ? cornerSpeed : straightSpeed, braking ? 0 : 100, braking ? 1 : 0,
        braking ? 3 : 8);
    }
  };

  const corner = () => {
    const steps = Math.round((Math.PI * radiusM) / ds);
    for (let i = 0; i < steps; i += 1) {
      heading += ds / radiusM;
      // Coasting through the first half, full throttle from the apex.
      const past = i > steps / 2;
      push(cornerSpeed, past ? 100 : 0, 0, past ? 5 : 3);
    }
  };

  straight();
  corner();
  straight();
  corner();
  return { x, y, speed, throttle, brake, gear };
}

describe('drivingStyle', () => {
  const lap = syntheticLap();
  const style = drivingStyle(lap, accelerationTrace(lap));

  it('measures the share of the lap at full throttle', () => {
    // Both straights are 80% full throttle, both corners 50%.
    const straightSamples = 2 * (400 / 2);
    const cornerSamples = 2 * Math.round((Math.PI * 100) / 2);
    const expected = (straightSamples * 0.8 + cornerSamples * 0.5)
      / (straightSamples + cornerSamples);
    expect(style.fullThrottleShare).toBeCloseTo(expected, 1);
  });

  it('measures braking and coasting as separate things', () => {
    // A fifth of each straight is braking; half of each corner is
    // neither pedal.
    expect(style.brakingShare).toBeGreaterThan(0.1);
    expect(style.coastingShare).toBeGreaterThan(0.1);
    // The three cannot overlap: a sample is on the throttle, on the
    // brakes, or on neither.
    expect(style.fullThrottleShare + style.brakingShare + style.coastingShare)
      .toBeLessThanOrEqual(1.0001);
  });

  it('counts gear changes in both directions', () => {
    // Down for each braking zone and corner entry, up at each exit.
    expect(style.gearChanges).toBeGreaterThan(0);
    expect(Number.isInteger(style.gearChanges)).toBe(true);
  });

  it('finds the corners and the speed carried through them', () => {
    expect(style.turns).toBe(2);
    expect(style.meanCornerMinimumKph).toBeCloseTo(120, 0);
  });

  it('measures how far past the apex the throttle comes back', () => {
    expect(style.meanThrottlePickupM).not.toBeNull();
    expect(style.pickupsCounted).toBe(2);
    // The throttle is already full from the apex in this lap.
    expect(style.meanThrottlePickupM).toBeLessThan(60);
  });

  it('leaves a corner out of the average rather than guessing at it', () => {
    // A lap that never reaches full throttle at all: the pickup has no
    // value, and says so instead of reporting the search window.
    const flat = syntheticLap();
    flat.throttle = flat.throttle.map(() => 40);
    const quiet = drivingStyle(flat, accelerationTrace(flat));
    expect(quiet.meanThrottlePickupM).toBeNull();
    expect(quiet.pickupsCounted).toBe(0);
    expect(quiet.fullThrottleShare).toBe(0);
  });

  it('has nothing to say about an empty lap', () => {
    expect(drivingStyle({ throttle: [], brake: [] }, { lateralG: [], longitudinalG: [], speedKph: [] })).toBeNull();
  });
});
