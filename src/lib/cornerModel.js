// The corner half of the Aero Explainer: what the geometry supports.
//
// A corner has a radius, and a car has a grip limit. Put them together
// and steady-state cornering says
//
//     v = sqrt(a_lat · r)
//
// The radius comes from the same curvature fit the rest of this page
// uses, so it is measured off the driven path. The grip limit is one
// number for the whole lap — the highest lateral g the car actually held
// anywhere on it — and every corner is then predicted from geometry
// alone.
//
// WHY ONE GRIP NUMBER AND NOT THE CORNER'S OWN
//
// Because a_lat = v²·κ is how the lateral g was computed in the first
// place. Feeding a corner's own measured g back into v = sqrt(a_lat/κ)
// returns the speed it was taken at, exactly, at every corner, and a
// model that reproduces its input is not a model. Holding grip constant
// across the lap is what makes the comparison say something.
//
// WHAT A DIFFERENCE MEANS, AND WHAT IT DOES NOT
//
// A corner taken at the model's speed was grip-limited: the car was
// doing all it could. A corner taken well below it was limited by
// something the model has no term for — braking for what comes next,
// a compromised entry to protect the exit onto a straight, traffic, a
// kerb, a wet patch, or a driver leaving margin.
//
// That is not a mistake list and must never be read as one. This model
// has no engine, no brakes, no gearbox, no sequence and no other cars;
// it treats each corner as a single steady-state instant. Being slower
// than it is the normal case around most of a lap.

const G = 9.80665;

// The radius quoted for a turn is a high percentile of its curvature,
// not the peak. The sharpest single sample in a corner is usually its
// entry transition, where the fit is seeing a change of direction rather
// than the corner itself — the same reason the turn table quotes a
// percentile of load instead of a maximum.
export const CURVATURE_PERCENTILE = 0.9;

// Within this much of the model, a corner is called grip-limited. It is
// a reading aid on the table, not a threshold anything is computed from.
export const GRIP_LIMITED_TOLERANCE_PCT = 5;

/** The curvature a turn sustains, as a percentile over its samples. */
export function sustainedCurvature(turn, curvature, percentile = CURVATURE_PERCENTILE) {
  const n = curvature.length;
  if (n === 0) return 0;
  const values = [];
  const span = (turn.endIndex - turn.startIndex + n) % n;
  for (let step = 0; step <= span; step += 1) {
    values.push(Math.abs(curvature[(turn.startIndex + step) % n]));
  }
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(percentile * values.length))];
}

/**
 * The single grip level this lap behaves as if it had.
 *
 * Each turn already carries its own answer: at its tightest point the
 * car was holding v²·κ of lateral acceleration. The median of those is
 * the lap's typical cornering grip — closed form, no search, and it
 * cannot run away from the data the way a fitted parameter can.
 *
 * The median rather than the peak, and this is the whole difference.
 * Predicting every corner at the highest g the car reached anywhere on
 * the lap says every corner should have been taken faster than it was,
 * by 13-41% on the laps published here — which is not a finding about
 * driving, it is a finding about using a maximum as an average.
 */
export function impliedGripG(turns, curvature, options = {}) {
  const values = [];
  for (const turn of turns) {
    const kappa = sustainedCurvature(turn, curvature, options.percentile);
    if (!(kappa > 0)) continue;
    const v = turn.minSpeedKph / 3.6;
    values.push((v * v * kappa) / G);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = values.length / 2;
  return values.length % 2
    ? values[(values.length - 1) / 2]
    : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Every detected turn against the model, at one grip level.
 *
 * `gripG` is the lateral g the model is allowed to assume. The caller
 * supplies it — the page defaults it to the lap's own measured peak and
 * lets a reader move it, which is the whole point: the question "what
 * would this lap look like with more grip" has an answer here, and it
 * is arithmetic on measurements rather than a simulation.
 */
export function cornerModel(turns, curvature, gripG, options = {}) {
  const { tolerancePct = GRIP_LIMITED_TOLERANCE_PCT, topSpeedKph = Infinity } = options;
  const aLat = gripG * G;

  const rows = turns.map((turn) => {
    const kappa = sustainedCurvature(turn, curvature, options.percentile);
    const radiusM = kappa > 0 ? 1 / kappa : null;
    const geometryKph = radiusM ? Math.sqrt(aLat * radiusM) * 3.6 : null;
    // A 484 m kink supports 405 km/h at this grip, and no car here goes
    // 405 km/h. The model has no engine, so where the geometry allows
    // more speed than the car reached anywhere on the lap it is not
    // making a claim about grip at all — that corner is limited by
    // something else, and it says so instead of printing a number the
    // car could not produce.
    const powerLimited = geometryKph != null && geometryKph > topSpeedKph;
    const modelKph = powerLimited ? null : geometryKph;
    const measuredKph = turn.minSpeedKph;
    const deltaKph = modelKph == null ? null : measuredKph - modelKph;
    const deltaPct = modelKph ? (deltaKph / modelKph) * 100 : null;
    return {
      number: turn.number,
      direction: turn.direction,
      radiusM,
      measuredKph,
      geometryKph,
      modelKph,
      deltaKph,
      deltaPct,
      powerLimited,
      gripLimited: deltaPct != null && Math.abs(deltaPct) <= tolerancePct,
    };
  });

  const usable = rows.filter((r) => r.deltaPct != null);
  const absolute = usable.map((r) => Math.abs(r.deltaPct)).sort((a, b) => a - b);
  const median = absolute.length === 0
    ? null
    : absolute.length % 2
      ? absolute[(absolute.length - 1) / 2]
      : (absolute[absolute.length / 2 - 1] + absolute[absolute.length / 2]) / 2;

  return {
    rows,
    gripG,
    turnsModelled: usable.length,
    turnsPowerLimited: rows.filter((r) => r.powerLimited).length,
    turnsGripLimited: usable.filter((r) => r.gripLimited).length,
    // How wrong the model is, stated in the same breath as its output.
    medianAbsErrorPct: median,
  };
}
