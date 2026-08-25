import { describe, expect, it } from 'vitest';
import { sensitivity } from './sensitivity.js';

const PARAMS = {
  total_laps: 40,
  base_pace_s: 90,
  fuel_effect_s_per_lap: 0.05,
  track_evolution_s_per_lap: 0,
  compounds: {
    SOFT: { offset_s: 0, deg_rate_s_per_lap: 0.12, deg_rate_ci_s: 0.04, quad_s_per_lap2: 0 },
    HARD: { offset_s: 0.6, deg_rate_s_per_lap: 0.04, deg_rate_ci_s: 0.01, quad_s_per_lap2: 0 },
  },
  strategy: [
    { compound: 'SOFT', laps: 15 },
    { compound: 'HARD', laps: 25 },
  ],
  pit_loss_s: 21,
  pit_loss_sigma_s: 1.5,
  sc_laps: [],
  sc_lap_extra_s: 0,
  traffic_penalty_s: [],
  iterations: 10,
  seed: 1,
};

describe('sensitivity', () => {
  it('moves each input to the edge of its own stated uncertainty', () => {
    const { rows } = sensitivity(PARAMS);
    const soft = rows.find((r) => r.label.startsWith('SOFT'));
    // 15 laps of tyre life summed: 1+2+...+15 = 120 lap-lives, times the
    // 0.04 s/lap edge of the interval.
    expect(soft.high).toBeCloseTo(120 * 0.04, 6);
    expect(soft.low).toBeCloseTo(-120 * 0.04, 6);
  });

  it('counts a pit-stop spread once per stop', () => {
    const { rows } = sensitivity(PARAMS);
    const pit = rows.find((r) => r.label === 'Pit loss');
    expect(pit.high).toBeCloseTo(1.5, 6); // one stop in a two-stint race
  });

  it('orders the rows by how much they move the answer', () => {
    const { rows } = sensitivity(PARAMS);
    const swing = (r) => Math.max(Math.abs(r.low), Math.abs(r.high));
    for (let i = 1; i < rows.length; i += 1) {
      expect(swing(rows[i - 1])).toBeGreaterThanOrEqual(swing(rows[i]));
    }
  });

  it('leaves out an input with no stated uncertainty', () => {
    const certain = {
      ...PARAMS,
      pit_loss_sigma_s: 0,
      compounds: {
        ...PARAMS.compounds,
        HARD: { ...PARAMS.compounds.HARD, deg_rate_ci_s: 0 },
      },
    };
    const labels = sensitivity(certain).rows.map((r) => r.label);
    expect(labels).toEqual(['SOFT degradation']);
  });
});
