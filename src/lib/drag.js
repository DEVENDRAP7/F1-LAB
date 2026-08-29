// The drag half of the Aero Explainer, done with what the feed carries.
//
// WHAT IS MEASURED
//
// When a driver lifts and does not brake, the car slows on its own. The
// deceleration at that moment is everything resisting it — aerodynamic
// drag, engine braking, drivetrain friction, rolling resistance — and it
// splits cleanly by how it scales with speed:
//
//     a = k·v² + c
//
// Drag is the v² term. Everything that does not care how fast the car is
// going lands in c. Fitting that line to real coasting samples gives k
// directly, in units of 1/m, from published speed and position alone.
//
// WHAT IS NOT CLAIMED
//
// Not C_dA. The quantity in the physics is F = ½ρv²C_dA, and dividing
// by mass to get an acceleration leaves k = ½ρC_dA/m. Recovering C_dA
// from k needs the car's mass and the air density on the day, and no
// source here publishes either. So k ships as itself: drag area per unit
// mass, which is a real measured property of the car and is the largest
// part of what k contains rather than all of it. Engine braking in gear
// is not perfectly speed-independent either, so k is *apparent* drag —
// the SPEC's own word — and the page says so.
//
// The comparison that does survive is between drivers and between
// circuits, because they are the same measurement made the same way: a
// car running less wing coasts with a smaller k.

const G = 9.80665;

// A coasting sample: off the throttle, off the brakes, quick, and going
// roughly straight. The last condition matters more than it looks —
// scrubbing speed off through a corner is deceleration that has nothing
// to do with drag, and a lap has far more of it than it has clean
// coasting.
export const COAST_THROTTLE_PCT = 5;
export const COAST_MIN_SPEED_KPH = 150;
export const COAST_MAX_LATERAL_G = 0.6;

// A fit needs enough samples and enough spread in speed. All the samples
// at one speed determine no slope at all: the line through them can be
// tilted any way at all and still pass through the cloud, so a k fitted
// from a narrow band is arithmetic rather than measurement.
export const MIN_COAST_SAMPLES = 60;
export const MIN_SPEED_SPAN_KPH = 40;
export const MIN_R_SQUARED = 0.3;

/** Indices where the car was coasting in a straight line. */
export function coastIndices(trace, channels, options = {}) {
  const {
    throttlePct = COAST_THROTTLE_PCT,
    minSpeedKph = COAST_MIN_SPEED_KPH,
    maxLateralG = COAST_MAX_LATERAL_G,
  } = options;
  const { throttle, brake } = channels;
  const { lateralG, longitudinalG, speedKph } = trace;
  if (!throttle || !brake) return [];

  const n = Math.min(
    throttle.length, brake.length,
    lateralG.length, longitudinalG.length, speedKph.length,
  );
  const out = [];
  for (let i = 0; i < n; i += 1) {
    if (throttle[i] > throttlePct) continue;
    if (brake[i] !== 0) continue;
    if (speedKph[i] < minSpeedKph) continue;
    if (Math.abs(lateralG[i]) > maxLateralG) continue;
    // Only samples where the car was actually slowing. A coast that
    // shows acceleration is a downhill, and gravity is not drag.
    if (longitudinalG[i] >= 0) continue;
    out.push(i);
  }
  return out;
}

/** Ordinary least squares of y on x, with the R² of the fit. */
export function fitLine(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

/**
 * Apparent drag from one lap's coasting samples.
 *
 * Returns either a fit or a refusal carrying the number that made the
 * decision — never a coefficient the samples do not support.
 */
export function dragFit(trace, channels, options = {}) {
  const {
    minSamples = MIN_COAST_SAMPLES,
    minSpeedSpanKph = MIN_SPEED_SPAN_KPH,
    minR2 = MIN_R_SQUARED,
  } = options;

  const indices = coastIndices(trace, channels, options);
  if (indices.length < minSamples) {
    return {
      available: false,
      samples: indices.length,
      reason: `only ${indices.length} coasting sample(s) on this lap — off throttle, off `
        + `brakes, above ${COAST_MIN_SPEED_KPH} km/h and roughly straight — and a fit needs `
        + `at least ${minSamples}`,
    };
  }

  const speeds = indices.map((i) => trace.speedKph[i]);
  const lo = Math.min(...speeds);
  const hi = Math.max(...speeds);
  if (hi - lo < minSpeedSpanKph) {
    return {
      available: false,
      samples: indices.length,
      reason: `every coasting sample fell between ${Math.round(lo)} and ${Math.round(hi)} km/h, `
        + `a span of ${Math.round(hi - lo)} km/h. Separating a v² term from a constant one `
        + `needs at least ${minSpeedSpanKph} km/h of spread`,
    };
  }

  const vSquared = indices.map((i) => (trace.speedKph[i] / 3.6) ** 2);
  const decel = indices.map((i) => -trace.longitudinalG[i] * G);
  const fit = fitLine(vSquared, decel);
  if (!fit) {
    return { available: false, samples: indices.length, reason: 'the samples carry no spread to fit' };
  }
  if (fit.slope <= 0) {
    return {
      available: false,
      samples: indices.length,
      reason: 'the fitted v² term came out negative, which is not drag — the coasting samples '
        + 'on this lap are dominated by something else, most likely gradient',
    };
  }
  if (fit.r2 < minR2) {
    return {
      available: false,
      samples: indices.length,
      r2: fit.r2,
      reason: `the fit explains only ${(fit.r2 * 100).toFixed(0)}% of the variation in these `
        + `samples, below the ${(minR2 * 100).toFixed(0)}% this page treats as a usable line`,
    };
  }

  return {
    available: true,
    // 1/m. Multiply by v² in m/s to get the deceleration drag alone causes.
    k: fit.slope,
    // m/s². Everything that does not scale with speed.
    constantDecel: fit.intercept,
    r2: fit.r2,
    samples: indices.length,
    speedRangeKph: [lo, hi],
    // The deceleration the v² term alone accounts for, at a speed.
    dragDecelAt: (kph) => fit.slope * (kph / 3.6) ** 2,
    // Where drag overtakes everything else. Below this the car is being
    // slowed mostly by its own drivetrain; above it, mostly by the air.
    crossoverKph: fit.intercept > 0 ? Math.sqrt(fit.intercept / fit.slope) * 3.6 : 0,
  };
}
