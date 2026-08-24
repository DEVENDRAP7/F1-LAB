// What-If Engine, JS side (M5, docs/SPEC.md).
//
// LINE-FOR-LINE PORT of pipeline/models/whatif.py — that module's
// docstring is the source of truth for the model definition, the fuel
// reference-point convention, and the RNG draw order. Every arithmetic
// statement is written in the same order as the Python reference so
// IEEE-754 doubles produce bit-identical results; both sides are pinned
// to the same expected output on the committed fixture
// (pipeline/tests/fixtures/). Do not "clean up" expression grouping here
// without making the identical change in Python.
//
// NOT wired into the site yet: M5 stays gated on the real-race
// validation test described in the Python docstring.

const MODULUS = 2147483647;
const MULTIPLIER = 48271;

export class ParkMillerRng {
  constructor(seed) {
    seed = seed % MODULUS;
    if (seed <= 0) {
      seed += MODULUS - 1;
    }
    this.state = seed;
  }

  next() {
    // state * 48271 < 2^53, so this stays exact in a double.
    this.state = (this.state * MULTIPLIER) % MODULUS;
    return this.state / MODULUS;
  }
}

export function validateParams(params) {
  let strategyLaps = 0;
  for (const stint of params.strategy) {
    strategyLaps += stint.laps;
  }
  if (strategyLaps !== params.total_laps) {
    throw new Error(`strategy covers ${strategyLaps} laps but the race is ${params.total_laps} laps`);
  }
  for (const stint of params.strategy) {
    if (!(stint.compound in params.compounds)) {
      throw new Error(`no degradation parameters for compound ${stint.compound}`);
    }
  }
}

export function simulateRace(params, stintDegRates, pitLosses) {
  const totalLaps = params.total_laps;
  const basePace = params.base_pace_s;
  const fuelEffect = params.fuel_effect_s_per_lap;
  const evolution = params.track_evolution_s_per_lap;
  const scLaps = new Set(params.sc_laps ?? []);
  const scExtra = params.sc_lap_extra_s ?? 0.0;
  const traffic = params.traffic_penalty_s ?? [];

  const lapTimes = [];
  let totalTime = 0.0;
  let lap = 0;

  for (let stintIndex = 0; stintIndex < params.strategy.length; stintIndex++) {
    const stint = params.strategy[stintIndex];
    const compound = params.compounds[stint.compound];
    const rate = stintDegRates[stintIndex];
    const isLastStint = stintIndex === params.strategy.length - 1;

    for (let life = 1; life <= stint.laps; life++) {
      lap += 1;
      const deg = compound.offset_s + rate * life + compound.quad_s_per_lap2 * life * life;
      let lapTime = basePace + deg;
      lapTime = lapTime + fuelEffect * (totalLaps - lap);
      lapTime = lapTime - evolution * (lap - 1);
      if (lap - 1 < traffic.length) {
        lapTime = lapTime + traffic[lap - 1];
      }
      if (scLaps.has(lap)) {
        lapTime = lapTime + scExtra;
      }
      if (life === stint.laps && !isLastStint) {
        lapTime = lapTime + pitLosses[stintIndex];
      }
      lapTimes.push(lapTime);
      totalTime = totalTime + lapTime;
    }
  }

  return { lap_times: lapTimes, total_time_s: totalTime };
}

export function monteCarlo(params) {
  validateParams(params);
  const rng = new ParkMillerRng(params.seed);
  const nStops = params.strategy.length - 1;

  const totals = [];
  for (let iteration = 0; iteration < params.iterations; iteration++) {
    const stintDegRates = [];
    for (const stint of params.strategy) {
      const compound = params.compounds[stint.compound];
      const u = rng.next();
      const rate = compound.deg_rate_s_per_lap + (2.0 * u - 1.0) * compound.deg_rate_ci_s;
      stintDegRates.push(rate);
    }
    const pitLosses = [];
    for (let stop = 0; stop < nStops; stop++) {
      const u = rng.next();
      const loss = params.pit_loss_s + (2.0 * u - 1.0) * params.pit_loss_sigma_s;
      pitLosses.push(loss);
    }

    const result = simulateRace(params, stintDegRates, pitLosses);
    totals.push(result.total_time_s);
  }

  return totals;
}

export function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const n = ordered.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return ordered[mid];
  }
  return (ordered[mid - 1] + ordered[mid]) / 2.0;
}
