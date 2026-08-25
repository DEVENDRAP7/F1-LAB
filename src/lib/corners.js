// Turn detection from the driven line.
//
// These are NOT the circuit's official corner numbers. No source this
// project uses publishes those, and a detected sequence does not match
// them in general: a kink the FIA numbers as a turn may carry too little
// lateral load to appear here, and a long double-apex the FIA numbers
// once can present as two. Everything downstream calls them detected
// turns and numbers them in lap order, which is a claim about this lap's
// geometry rather than about the circuit's naming.
//
// A turn is a run of the lap where the car was carrying real lateral
// load, so the definition is a threshold on lateral g with a minimum
// length — short enough to catch a fast kink, long enough that a single
// noisy sample on a straight is not a corner.

const G_THRESHOLD = 1.0;
const MIN_LENGTH_M = 25;
// Two runs separated by less than this are one turn: a double apex
// releases load briefly in the middle, and splitting there would report
// two turns where a driver drove one.
const MERGE_GAP_M = 40;
// Smoothed before thresholding, for the same reason the map's colour is:
// the per-sample fit crosses a threshold several times through one
// corner.
const SMOOTHING = 5;
// The load a turn is quoted at: a high percentile within it, never its
// single strongest sample.
const TURN_LOAD_PERCENTILE = 0.9;

function smoothedMagnitude(values, half) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -half; k <= half; k += 1) {
      const v = values[(i + k + n) % n];
      if (Number.isFinite(v)) {
        sum += Math.abs(v);
        count += 1;
      }
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

/**
 * Detected turns, in lap order.
 *
 * `trace` is the output of aero.accelerationTrace; `ds` is the sample
 * spacing in metres. Each turn carries the figures that describe how it
 * was driven, all of them read off the lap rather than modelled.
 */
export function detectTurns(trace, ds = 2, options = {}) {
  const {
    gThreshold = G_THRESHOLD,
    minLengthM = MIN_LENGTH_M,
    mergeGapM = MERGE_GAP_M,
    smoothing = SMOOTHING,
  } = options;

  const { lateralG, speedKph } = trace;
  const n = lateralG.length;
  if (n === 0) return [];

  const load = smoothedMagnitude(lateralG, smoothing);
  const over = Array.from({ length: n }, (_, i) => load[i] >= gThreshold);

  // Collect runs on the closed lap: start from a sample that is not in a
  // turn, so a turn spanning the start/finish line is not cut in two.
  const start = over.indexOf(false);
  if (start === -1) return []; // the whole lap over threshold: not turns

  const runs = [];
  let current = null;
  for (let step = 0; step < n; step += 1) {
    const i = (start + step) % n;
    if (over[i]) {
      if (!current) current = { indices: [] };
      current.indices.push(i);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);

  // Merge runs separated by a short release of load.
  const merged = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous) {
      const gap = run.indices[0] - previous.indices[previous.indices.length - 1];
      const wrappedGap = gap < 0 ? gap + n : gap;
      if ((wrappedGap - 1) * ds <= mergeGapM) {
        for (let i = 1; i < wrappedGap; i += 1) {
          previous.indices.push((previous.indices[previous.indices.length - 1] + 1) % n);
        }
        previous.indices.push(...run.indices);
        continue;
      }
    }
    merged.push(run);
  }

  const turns = [];
  for (const run of merged) {
    const lengthM = run.indices.length * ds;
    if (lengthM < minLengthM) continue;

    // The load through the turn is reported as a high percentile of the
    // smoothed trace, not its maximum. Two reasons, both learned on real
    // laps: the sharpest single sample in a corner is usually its entry
    // transition, where the fit sees a change of direction rather than
    // the corner; and a handful of samples per lap still land outside
    // what any car can do — reporting the maximum published one turn at
    // Zandvoort as 9.9g. The apex is still located at the strongest
    // sample, because that is a position rather than a number.
    let apex = run.indices[0];
    let strongest = 0;
    let minSpeed = Infinity;
    const loads = [];
    for (const i of run.indices) {
      const g = load[i];
      loads.push(g);
      if (g > strongest) {
        strongest = g;
        apex = i;
      }
      if (speedKph[i] < minSpeed) minSpeed = speedKph[i];
    }
    loads.sort((a, b) => a - b);
    const sustained = loads[Math.min(loads.length - 1, Math.floor(TURN_LOAD_PERCENTILE * loads.length))];

    turns.push({
      number: turns.length + 1,
      startIndex: run.indices[0],
      endIndex: run.indices[run.indices.length - 1],
      apexIndex: apex,
      lengthM,
      sustainedLateralG: sustained,
      minSpeedKph: minSpeed,
      entrySpeedKph: speedKph[run.indices[0]],
      exitSpeedKph: speedKph[run.indices[run.indices.length - 1]],
      // Which way it goes, from the sign the curvature kept.
      direction: lateralG[apex] >= 0 ? 'left' : 'right',
    });
  }

  return turns;
}

export const TURN_DEFAULTS = {
  gThreshold: G_THRESHOLD,
  minLengthM: MIN_LENGTH_M,
  mergeGapM: MERGE_GAP_M,
};

/**
 * Time gained or lost through each turn, from a cumulative delta trace.
 *
 * `delta` is lib/delta.js's trace: the running time difference between a
 * comparison lap and the reference, sample by sample. The difference
 * between its value at the end of a turn and at the start is therefore
 * exactly the time that turn accounted for — no separate integration,
 * and no assumption about where a corner "really" begins beyond the
 * detection itself.
 *
 * A turn that spans the start/finish line has its end index before its
 * start index; the lap's own total is added back so the section is not
 * reported as the whole lap in reverse.
 */
export function turnDeltas(turns, delta) {
  if (!delta || delta.length === 0) return [];
  const lapTotal = delta[delta.length - 1];
  return turns.map((turn) => {
    const start = delta[turn.startIndex];
    const end = turn.endIndex >= turn.startIndex
      ? delta[turn.endIndex]
      : delta[turn.endIndex] + lapTotal;
    return { number: turn.number, deltaS: end - start };
  });
}
