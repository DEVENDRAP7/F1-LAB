import { describe, expect, it } from 'vitest';
import { titleDecided } from './championship.js';

const drivers = (flags) =>
  Object.fromEntries(flags.map((eliminated, i) => [`D${i}`, { eliminated }]));

describe('titleDecided', () => {
  it('is decided when every driver but the leader is out', () => {
    const e = { remainingRounds: 3, drivers: drivers([false, true, true, true]) };
    expect(titleDecided(4, e)).toBe(true);
  });

  it('is not decided while a second driver can still win it', () => {
    const e = { remainingRounds: 3, drivers: drivers([false, false, true, true]) };
    expect(titleDecided(4, e)).toBe(false);
  });

  it('is not decided when nobody is out yet', () => {
    const e = { remainingRounds: 22, drivers: drivers([false, false, false]) };
    expect(titleDecided(3, e)).toBe(false);
  });

  it('is not shown once the season is over, because nothing is left to decide', () => {
    const e = { remainingRounds: 0, drivers: drivers([false, true, true]) };
    expect(titleDecided(3, e)).toBe(false);
  });

  it('needs more than one driver to be a contest at all', () => {
    expect(titleDecided(1, { remainingRounds: 3, drivers: drivers([false]) })).toBe(false);
    expect(titleDecided(0, { remainingRounds: 3, drivers: {} })).toBe(false);
  });

  it('does not count a tie on the bound as decided', () => {
    // A driver exactly level with the leader on the bound is not
    // eliminated (see compute_elimination), so they are the second driver
    // who can still win and the title is open.
    const e = { remainingRounds: 1, drivers: drivers([false, false, true]) };
    expect(titleDecided(3, e)).toBe(false);
  });

  it('says false rather than throwing when the elimination block is absent', () => {
    expect(titleDecided(22, undefined)).toBe(false);
    expect(titleDecided(22, null)).toBe(false);
    expect(titleDecided(22, { remainingRounds: 3 })).toBe(false);
  });

  it('does not mistake a mismatched driver count for a decided title', () => {
    // 21 eliminated out of a 22-row table is decided; 21 eliminated
    // against a 25-row table is not, however the two lists came to differ.
    const flags = [false, ...Array(21).fill(true)];
    expect(titleDecided(22, { remainingRounds: 3, drivers: drivers(flags) })).toBe(true);
    expect(titleDecided(25, { remainingRounds: 3, drivers: drivers(flags) })).toBe(false);
  });
});
