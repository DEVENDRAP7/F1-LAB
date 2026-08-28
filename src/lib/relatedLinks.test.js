import { describe, expect, it } from 'vitest';
import { DESTINATIONS, circuitForRound, relatedLinks, roundForCircuit } from './relatedLinks.js';

const calendar = [
  { round: 1, circuitId: 'albert_park' },
  { round: 12, circuitId: 'silverstone' },
];

describe('relatedLinks', () => {
  it('carries only what the destination uses', () => {
    const [strategy] = relatedLinks(['/strategy'], { round: 12, session: 'R', circuit: 'x' });
    expect(strategy.params).toEqual({ round: 12 });
  });

  it('carries the session where the destination has one', () => {
    const [lines] = relatedLinks(['/lines'], { round: 12, session: 'R' });
    expect(lines.params).toEqual({ round: 12, session: 'R' });
  });

  it('keys the atlas by circuit, not round', () => {
    const [atlas] = relatedLinks(['/circuits'], { round: 12, circuit: 'silverstone' });
    expect(atlas.params).toEqual({ circuit: 'silverstone' });
  });

  it('leaves out a parameter that is not set', () => {
    const [lines] = relatedLinks(['/lines'], { round: 12, session: '' });
    expect(lines.params).toEqual({ round: 12 });
  });

  it('keeps the order it was asked for and drops unknown paths', () => {
    const out = relatedLinks(['/whatif', '/nope', '/strategy'], { round: 3 });
    expect(out.map((l) => l.to)).toEqual(['/whatif', '/strategy']);
  });

  it('gives every destination a label and a note', () => {
    const links = relatedLinks(Object.keys(DESTINATIONS), { round: 1, circuit: 'monza' });
    expect(links).toHaveLength(Object.keys(DESTINATIONS).length);
    for (const link of links) {
      expect(link.label).toBeTruthy();
      expect(link.note).toBeTruthy();
      expect(Object.keys(link.params).length).toBeGreaterThan(0);
    }
  });
});

describe('circuitForRound', () => {
  it('matches across string and number rounds', () => {
    expect(circuitForRound(calendar, '12')).toBe('silverstone');
    expect(circuitForRound(calendar, 12)).toBe('silverstone');
  });

  it('returns empty rather than a wrong track when there is no match', () => {
    expect(circuitForRound(calendar, 99)).toBe('');
    expect(circuitForRound(null, 1)).toBe('');
    expect(circuitForRound(calendar, '')).toBe('');
  });
});

describe('roundForCircuit', () => {
  it('finds the round run at a circuit', () => {
    expect(roundForCircuit(calendar, 'silverstone')).toBe(12);
  });

  it('takes the later round when a circuit is visited twice', () => {
    const twice = [
      { round: 2, circuitId: 'bahrain' },
      { round: 20, circuitId: 'bahrain' },
    ];
    expect(roundForCircuit(twice, 'bahrain')).toBe(20);
  });

  it('returns empty rather than a wrong round', () => {
    expect(roundForCircuit(calendar, 'monza')).toBe('');
    expect(roundForCircuit(calendar, '')).toBe('');
    expect(roundForCircuit(null, 'monza')).toBe('');
  });
});
