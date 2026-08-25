import { simulateRace } from './whatifModel.js';

// Which of the fitted numbers the answer actually depends on.
//
// A Monte Carlo distribution says how wide the answer is; it does not say
// what is making it wide. This moves one input at a time to the edge of
// its own stated uncertainty — a compound's degradation rate to the ends
// of its fitted confidence interval, a pit stop to the spread of the
// stops this driver actually made — and reports what that does to the
// race time.
//
// Everything here is deterministic: the same strategy, the same race, one
// number changed. That is what makes it readable as "this is the term
// that matters", which a sampled distribution cannot show.

function nominalRates(params) {
  return params.strategy.map((stint) => params.compounds[stint.compound].deg_rate_s_per_lap);
}

function totalWith(params, rates, pitLoss) {
  const stops = Math.max(0, params.strategy.length - 1);
  return simulateRace(params, rates, new Array(stops).fill(pitLoss)).total_time_s;
}

/**
 * One row per input that carries a stated uncertainty, with the race time
 * at each end of it. Rows are ordered by how much they move the answer.
 */
export function sensitivity(params) {
  const base = totalWith(params, nominalRates(params), params.pit_loss_s);
  const rows = [];

  const compoundsInUse = new Set(params.strategy.map((s) => s.compound));
  for (const compound of compoundsInUse) {
    const spec = params.compounds[compound];
    const ci = spec.deg_rate_ci_s ?? 0;
    if (!(ci > 0)) continue;
    const shift = (direction) =>
      params.strategy.map((stint, i) =>
        (stint.compound === compound
          ? nominalRates(params)[i] + direction * ci
          : nominalRates(params)[i]));
    rows.push({
      label: `${compound} degradation`,
      detail: `${spec.deg_rate_s_per_lap.toFixed(3)} ± ${ci.toFixed(3)} s/lap`,
      low: totalWith(params, shift(-1), params.pit_loss_s) - base,
      high: totalWith(params, shift(1), params.pit_loss_s) - base,
    });
  }

  const sigma = params.pit_loss_sigma_s ?? 0;
  if (sigma > 0 && params.strategy.length > 1) {
    rows.push({
      label: 'Pit loss',
      detail: `${params.pit_loss_s.toFixed(1)} ± ${sigma.toFixed(1)} s per stop`,
      low: totalWith(params, nominalRates(params), params.pit_loss_s - sigma) - base,
      high: totalWith(params, nominalRates(params), params.pit_loss_s + sigma) - base,
    });
  }

  rows.sort(
    (a, b) => Math.max(Math.abs(b.low), Math.abs(b.high))
      - Math.max(Math.abs(a.low), Math.abs(a.high)),
  );
  return { baseTotalS: base, rows };
}
