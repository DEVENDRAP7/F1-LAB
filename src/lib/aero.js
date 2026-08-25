// Aerodynamic signature from a real driven lap.
//
// Everything here is arithmetic on the racing-line channels the pipeline
// already publishes — position in metres on a uniform 2 m grid, and
// speed. No new data, no new fetch.
//
// WHAT IS MEASURED
//   lateral acceleration     a_lat = v² · κ     (κ = path curvature)
//   longitudinal acceleration a_lon = v · dv/ds
// Both fall out of geometry and speed alone. They are facts about the
// lap, in g.
//
// WHAT IS NOT CLAIMED
// Not downforce, not C_dA, not a drag coefficient. Those need mass, air
// density and frontal area — none of which this source publishes, and
// all of which would have to be assumed. The relationship the page shows
// is the honest one: how much lateral g the car actually sustained at
// each speed. A car with more downforce holds more g as speed rises;
// that shape is visible without inventing a single constant.
//
// Braking g is likewise "longitudinal deceleration", not drag: it is
// brakes, engine braking and aerodynamic drag together, and nothing in
// this data separates them.

const G = 9.80665;

// Position arrives at roughly 3.7 Hz and is interpolated onto the 2 m
// grid, so between two published fixes the path is a straight segment
// with a kink at each end. At 300 km/h those fixes are more than 20 m
// apart, which means the grid carries far more resolution than the
// source does, and a three-point derivative taken over 2 m measures the
// interpolation kink rather than the corner.
//
// That is not a small error. Measured over 2 m, Zandvoort's fastest laps
// came out at 18-24g lateral — several times what a Formula 1 car can
// generate, and a number that would have discredited every honest figure
// beside it.
//
// So curvature is taken over a window wide enough to span the real
// sampling interval, by fitting a circle to every point in the window. Through a
// constant-radius corner that fit is the corner, however wide the window;
// it only smooths the transitions in and out of one.
// The window has to span several real fixes, and how far apart those are
// depends entirely on how fast the car was going: at 316 km/h they are
// about 24 m apart, at 80 km/h about 6 m. A fixed ±16 m window is three
// real fixes in a hairpin and barely one on the pit straight — and on the
// straight it fitted 25 m radius circles to position noise, reporting 30g
// at 316 km/h. So the window is sized in metres from the speed at the
// sample, never below the floor.
export const CURVATURE_MIN_HALF_WINDOW_M = 16;
export const CURVATURE_FIXES_PER_HALF_WINDOW = 1.5;
export const SOURCE_FIX_HZ = 3.7;

// Speed is published on the same fixes, so its derivative is smoothed
// over a window too, though a narrower one: speed is interpolated
// linearly and does not get differentiated twice.
export const SPEED_HALF_WINDOW = 4;


/**
 * Signed curvature from a least-squares parabola fitted to a window of
 * path points, in a frame aligned with the window's own chord.
 *
 * Two estimators were tried and discarded first, and both failure modes
 * are worth keeping in view:
 *
 *   Three-point (Menger) curvature is exact for a circular arc, but the
 *   path is not one — it is a polygon of straight segments between
 *   published fixes, so three points sample the interpolation ripple
 *   instead of the corner. Through a 150 m corner it read 33% high.
 *
 *   An algebraic circle fit over the whole window averages that ripple
 *   out, but its normal equations are ill-conditioned when the points are
 *   nearly collinear — which is every straight. On synthetic noise at the
 *   feed's own 0.1 m quantisation it returned 39 m radii, i.e. 18g at
 *   racing speed.
 *
 * A parabola in the chord frame has neither problem. It is an ordinary
 * linear least-squares fit, so it stays well conditioned on a straight
 * (where it simply returns a ≈ 0), and it uses every point in the window
 * rather than three.
 */
function fitCurvature(px, py, indices) {
  const n = indices.length;
  const a0 = indices[0];
  const a1 = indices[n - 1];
  const chordX = px[a1] - px[a0];
  const chordY = py[a1] - py[a0];
  const chord = Math.hypot(chordX, chordY);
  if (chord < 1e-6) return 0;
  const tx = chordX / chord;
  const ty = chordY / chord;
  // Left-hand normal, so a positive fitted quadratic term means a
  // left-hand turn: the sign is the direction of the corner, and keeping
  // it is what makes a g-g plot a full circle rather than half of one.
  const nx = -ty;
  const ny = tx;

  const ox = px[indices[Math.floor(n / 2)]];
  const oy = py[indices[Math.floor(n / 2)]];

  // Normal equations for u = A t² + B t + C.
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const i of indices) {
    const dx = px[i] - ox;
    const dy = py[i] - oy;
    const t = dx * tx + dy * ty;
    const u = dx * nx + dy * ny;
    const t2 = t * t;
    s0 += 1;
    s1 += t;
    s2 += t2;
    s3 += t2 * t;
    s4 += t2 * t2;
    b0 += u;
    b1 += u * t;
    b2 += u * t2;
  }

  // 3x3 solve by Cramer's rule on [[s4,s3,s2],[s3,s2,s1],[s2,s1,s0]].
  const det =
    s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
  if (Math.abs(det) < 1e-9) return 0;
  const detA =
    b2 * (s2 * s0 - s1 * s1) - s3 * (b1 * s0 - s1 * b0) + s2 * (b1 * s1 - s2 * b0);
  const detB =
    s4 * (b1 * s0 - b0 * s1) - b2 * (s3 * s0 - s1 * s2) + s2 * (s3 * b0 - b1 * s2);
  const A = detA / det;
  const B = detB / det;

  return (2 * A) / (1 + B * B) ** 1.5;
}

/**
 * Per-sample lateral and longitudinal acceleration, in g.
 *
 * `x` and `y` are metres on a uniform `ds` grid; `speed` is km/h. The
 * lap is treated as a closed loop, so the windows wrap rather than
 * truncate — clamping would put a fake straight across the start/finish
 * line, which at most circuits falls in the middle of a corner exit.
 */
export function accelerationTrace(
  { x, y, speed },
  ds = 2,
  minHalfWindowM = CURVATURE_MIN_HALF_WINDOW_M,
  speedHalfWindow = SPEED_HALF_WINDOW,
) {
  const n = Math.min(x.length, y.length, speed.length);
  const minHalfWindow = Math.max(2, Math.round(minHalfWindowM / ds));
  if (n < 2 * minHalfWindow + 3) {
    return { lateralG: [], longitudinalG: [], speedKph: [], curvature: [] };
  }

  const px = Array.from(x).slice(0, n);
  const py = Array.from(y).slice(0, n);
  const kph = Array.from(speed).slice(0, n);
  const v = kph.map((s) => s / 3.6); // m/s
  const at = (i) => (i + n * 2) % n;

  const lateralG = new Array(n);
  const longitudinalG = new Array(n);
  const curvature = new Array(n);

  for (let i = 0; i < n; i += 1) {
    // Fix spacing at this speed, in metres, then the window that spans
    // CURVATURE_FIXES_PER_HALF_WINDOW of them either side.
    const fixSpacingM = v[i] / SOURCE_FIX_HZ;
    const halfWindow = Math.min(
      Math.floor((n - 1) / 2),
      Math.max(
        minHalfWindow,
        Math.round((CURVATURE_FIXES_PER_HALF_WINDOW * fixSpacingM) / ds),
      ),
    );
    const window = [];
    for (let k = -halfWindow; k <= halfWindow; k += 1) window.push(at(i + k));
    const k = fitCurvature(px, py, window);
    curvature[i] = k;
    lateralG[i] = (v[i] * v[i] * k) / G;

    // dv/ds across the same kind of window, so a single interpolated
    // step cannot set the braking figure.
    const back = at(i - speedHalfWindow);
    const fwd = at(i + speedHalfWindow);
    const dvds = (v[fwd] - v[back]) / (2 * speedHalfWindow * ds);
    longitudinalG[i] = (v[i] * dvds) / G;
  }

  return { lateralG, longitudinalG, speedKph: kph, curvature };
}

/**
 * The lateral-g envelope by speed: for each speed bin, the g the car
 * actually sustained there.
 *
 * A high percentile rather than the maximum, because one noisy sample
 * would otherwise set the whole envelope. Bins with too few samples are
 * dropped rather than drawn from almost nothing.
 */
// Exported because a consumer plotting the envelope has to know the band
// width to tell "the next band" from "a band that was dropped".
export const ENVELOPE_BIN_KPH = 20;

export function lateralEnvelope(
  trace,
  { binKph = ENVELOPE_BIN_KPH, percentile = 0.95, minSamples = 8 } = {},
) {
  const bins = new Map();
  for (let i = 0; i < trace.lateralG.length; i += 1) {
    const speed = trace.speedKph[i];
    if (!Number.isFinite(speed) || speed <= 0) continue;
    const bin = Math.floor(speed / binKph) * binKph;
    if (!bins.has(bin)) bins.set(bin, []);
    // The envelope is about how much grip was sustained, not which way
    // the corner went, so magnitude here.
    bins.get(bin).push(Math.abs(trace.lateralG[i]));
  }

  const out = [];
  for (const [bin, values] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    if (values.length < minSamples) continue;
    values.sort((a, b) => a - b);
    const idx = Math.min(values.length - 1, Math.floor(percentile * values.length));
    out.push({
      speedKph: bin + binKph / 2,
      lateralG: values[idx],
      samples: values.length,
    });
  }
  return out;
}

// The headline figures are high percentiles, not maxima.
//
// Lateral and longitudinal g are both derived by differentiating a trace
// that was interpolated from fixes ~24 m apart at speed. That process
// leaves a handful of samples per lap — four out of 2232 on Zandvoort's
// fastest lap — where the fit lands on a radius the car could not have
// driven. Reporting the maximum publishes one of those as the headline;
// reporting the 99th percentile reports what the car actually sustained
// and lets the noise stay where it belongs. The page says which it is.
export const PEAK_PERCENTILE = 0.99;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(p * ordered.length))];
}

/**
 * Headline figures for a lap: the g the car sustained, and its top speed.
 *
 * Speed is published directly by the source rather than derived, so it is
 * a true maximum — nothing about it needs guarding.
 */
export function peaks(trace, p = PEAK_PERCENTILE) {
  const lateral = [];
  const braking = [];
  const accel = [];
  let topSpeed = 0;
  for (let i = 0; i < trace.lateralG.length; i += 1) {
    if (Number.isFinite(trace.lateralG[i])) lateral.push(Math.abs(trace.lateralG[i]));
    const lon = trace.longitudinalG[i];
    if (Number.isFinite(lon)) (lon < 0 ? braking : accel).push(Math.abs(lon));
    if (trace.speedKph[i] > topSpeed) topSpeed = trace.speedKph[i];
  }
  return {
    peakLateralG: percentile(lateral, p),
    peakBrakingG: percentile(braking, p),
    peakAccelG: percentile(accel, p),
    topSpeedKph: topSpeed,
    percentile: p,
  };
}
