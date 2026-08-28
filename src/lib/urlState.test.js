import { describe, expect, it } from 'vitest';
import { foldParams, nextParams, withParams } from './urlState.js';

describe('nextParams', () => {
  it('sets a value', () => {
    expect(nextParams('', 'round', 12).toString()).toBe('round=12');
  });

  it('drops the key when the value matches the default', () => {
    expect(nextParams('session=R', 'session', 'Q', 'Q').toString()).toBe('');
  });

  it('drops the key when the value is cleared', () => {
    expect(nextParams('round=4', 'round', '').toString()).toBe('');
  });

  it('leaves other keys alone', () => {
    const out = nextParams('round=4&driver=NOR', 'session', 'R', 'Q');
    expect(out.get('round')).toBe('4');
    expect(out.get('driver')).toBe('NOR');
    expect(out.get('session')).toBe('R');
  });

  it('compares against the default as a string, so a numeric default still clears', () => {
    expect(nextParams('n=1', 'n', 1, 1).toString()).toBe('');
  });

  it('does not mutate what it was given', () => {
    const before = new URLSearchParams('round=4');
    nextParams(before, 'round', 9);
    expect(before.get('round')).toBe('4');
  });
});

describe('withParams', () => {
  it('returns a bare path when nothing is worth carrying', () => {
    expect(withParams('/lines', { round: '', session: null })).toBe('/lines');
  });

  it('carries the values that are set', () => {
    expect(withParams('/lines', { round: 12, session: 'Q' })).toBe('/lines?round=12&session=Q');
  });

  it('drops empty values but keeps the rest', () => {
    expect(withParams('/whatif', { round: 3, driver: undefined })).toBe('/whatif?round=3');
  });

  it('keeps a zero, which is a value and not a blank', () => {
    expect(withParams('/x', { n: 0 })).toBe('/x?n=0');
  });
});

describe('foldParams', () => {
  it('writes several keys in one pass', () => {
    const out = foldParams('', { round: 11, session: 'R' }, { session: 'Q' });
    expect(out.get('round')).toBe('11');
    expect(out.get('session')).toBe('R');
  });

  it('still drops a key that lands on its default', () => {
    const out = foldParams('session=R', { round: 11, session: 'Q' }, { session: 'Q' });
    expect(out.get('round')).toBe('11');
    expect(out.has('session')).toBe(false);
  });

  it('keeps keys it was not asked about', () => {
    const out = foldParams('driver=NOR', { round: 2 });
    expect(out.get('driver')).toBe('NOR');
  });
});
