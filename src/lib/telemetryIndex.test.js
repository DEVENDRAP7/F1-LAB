import { describe, expect, it } from 'vitest';
import { isUnavailable, newestRoundWithLines, sessionsWithLines } from './telemetryIndex.js';

const INDEX = {
  rounds: {
    9: { R: { drivers: ['LEC', 'NOR'], unavailable: false } },
    10: { R: { drivers: ['VER'], unavailable: false } },
    11: { R: { drivers: [], unavailable: true } },
    12: {
      Q: { drivers: ['PIA'], unavailable: false },
      R: { drivers: ['HAM'], unavailable: false },
    },
  },
};

describe('telemetry index', () => {
  it('prefers qualifying where a round has both', () => {
    expect(sessionsWithLines(INDEX, 12)).toEqual(['Q', 'R']);
    expect(newestRoundWithLines(INDEX, [12, 11, 10, 9])).toEqual({
      round: '12',
      session: 'Q',
    });
  });

  it('falls back to the race when no round has qualifying', () => {
    const raceOnly = { rounds: { 10: INDEX.rounds[10], 9: INDEX.rounds[9] } };
    expect(newestRoundWithLines(raceOnly, [10, 9])).toEqual({ round: '10', session: 'R' });
  });

  it('never lands on a round that exists only to say it has nothing', () => {
    const refusals = { rounds: { 11: INDEX.rounds[11] } };
    expect(newestRoundWithLines(refusals, [11])).toBeNull();
    expect(sessionsWithLines(INDEX, 11)).toEqual([]);
    expect(isUnavailable(INDEX, 11, 'R')).toBe(true);
  });

  it('says nothing rather than guessing for a round it has never heard of', () => {
    expect(sessionsWithLines(INDEX, 3)).toEqual([]);
    expect(isUnavailable(INDEX, 3, 'R')).toBe(false);
  });
});
