// What-If Monte Carlo worker (M5, docs/SPEC.md 2.5): the simulation runs
// entirely on the user's device, off the main thread, with a visible
// progress state. All model logic lives in lib/whatifModel.js — the
// tested line-for-line port of pipeline/models/whatif.py — and this file
// only chunks the iterations and reports progress/results.
//
// Not yet reachable from any page: M5 stays gated on the real-race
// validation test (see the Python module's docstring).

import { ParkMillerRng, median, simulateRace, validateParams } from '../lib/whatifModel.js';

const PROGRESS_EVERY = 100;

self.onmessage = (event) => {
  const params = event.data;

  try {
    validateParams(params);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
    return;
  }

  // Mirrors monteCarlo() exactly (same RNG draw order), unrolled here
  // only so progress can be posted between chunks.
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

    totals.push(simulateRace(params, stintDegRates, pitLosses).total_time_s);

    if ((iteration + 1) % PROGRESS_EVERY === 0) {
      self.postMessage({ type: 'progress', done: iteration + 1, of: params.iterations });
    }
  }

  const ordered = [...totals].sort((a, b) => a - b);
  const percentile = (p) => ordered[Math.min(ordered.length - 1, Math.floor(p * ordered.length))];

  self.postMessage({
    type: 'result',
    totals,
    summary: {
      median_total_s: median(totals),
      p05_total_s: percentile(0.05),
      p95_total_s: percentile(0.95),
      iterations: totals.length,
    },
  });
};
