// Delta-time math for M3 (docs/SPEC.md): every comparison runs on the
// distance axis, never time. Speed channels arrive as the pipeline's raw
// Int16 encoding (km/h × 10) resampled to a fixed distance grid, so the
// time to cross one 2 m segment is spacing / v, and the delta trace is
// the difference of the two cumulative-time curves point by point.

// Below this raw value (1 km/h) a sample is treated as stationary noise
// and clamped, so a zero sample can't produce an infinite segment time.
const MIN_SPEED_RAW = 10;

/**
 * Cumulative time (seconds) to reach each grid point from point 0.
 * @param {Int16Array|number[]} speedRaw - speed channel, km/h × 10
 * @param {number} spacingM - grid spacing in metres (manifest-declared)
 * @returns {Float64Array} same length as speedRaw; [0] is 0
 */
export function cumulativeTimes(speedRaw, spacingM) {
  const out = new Float64Array(speedRaw.length);
  let t = 0;
  for (let i = 1; i < speedRaw.length; i++) {
    // Trapezoid on speed across the segment; raw/36 converts km/h×10 to m/s.
    const a = Math.max(speedRaw[i - 1], MIN_SPEED_RAW);
    const b = Math.max(speedRaw[i], MIN_SPEED_RAW);
    const vMps = (a + b) / 2 / 36;
    t += spacingM / vMps;
    out[i] = t;
  }
  return out;
}

/**
 * Delta-time trace of a comparison lap against a reference lap, both on
 * the same distance grid. Positive means the comparison lap is behind.
 * The final element is the full lap-time gap — the M3 "done when" check
 * is that this agrees with the real timing gap within 0.1 s.
 * @returns {Float64Array} truncated to the shorter of the two inputs
 */
export function deltaTrace(referenceSpeedRaw, comparisonSpeedRaw, spacingM) {
  const n = Math.min(referenceSpeedRaw.length, comparisonSpeedRaw.length);
  const ref = cumulativeTimes(referenceSpeedRaw.subarray ? referenceSpeedRaw.subarray(0, n) : referenceSpeedRaw.slice(0, n), spacingM);
  const cmp = cumulativeTimes(comparisonSpeedRaw.subarray ? comparisonSpeedRaw.subarray(0, n) : comparisonSpeedRaw.slice(0, n), spacingM);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = cmp[i] - ref[i];
  }
  return out;
}

/** Total lap time in seconds implied by a speed channel on the grid. */
export function lapTimeSeconds(speedRaw, spacingM) {
  const times = cumulativeTimes(speedRaw, spacingM);
  return times[times.length - 1];
}
