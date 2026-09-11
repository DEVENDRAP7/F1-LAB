import { describe, expect, it } from 'vitest';
import {
  dismiss,
  flagKey,
  load,
  partition,
  restore,
  restoreAll,
  save,
} from './dismissed.js';

/** A localStorage stand-in, with a switch for the ways the real one fails. */
function fakeStorage({ readThrows = false, writeThrows = false, seed = null } = {}) {
  let value = seed;
  return {
    getItem() {
      if (readThrows) throw new Error('blocked');
      return value;
    },
    setItem(_key, next) {
      if (writeThrows) throw new Error('quota');
      value = next;
    },
    get raw() {
      return value;
    },
  };
}

describe('flagKey', () => {
  it('is stable across a round arriving as a string or a number', () => {
    expect(flagKey('13', 'norris', 24)).toBe(flagKey(13, 'norris', '24'));
  });

  it('separates the same lap number in different races and drivers', () => {
    expect(flagKey(13, 'norris', 24)).not.toBe(flagKey(12, 'norris', 24));
    expect(flagKey(13, 'norris', 24)).not.toBe(flagKey(13, 'piastri', 24));
  });
});

describe('load', () => {
  it('is empty when nothing has been dismissed', () => {
    expect(load(fakeStorage()).size).toBe(0);
  });

  it('reads back what was saved', () => {
    const storage = fakeStorage();
    save(new Set(['13:norris:24']), storage);
    expect([...load(storage)]).toEqual(['13:norris:24']);
  });

  it('discards a stored value that is not a list of keys', () => {
    expect(load(fakeStorage({ seed: '{"round":13}' })).size).toBe(0);
    expect(load(fakeStorage({ seed: 'not json at all' })).size).toBe(0);
    expect([...load(fakeStorage({ seed: '["13:norris:24", 7, null]' }))])
      .toEqual(['13:norris:24']);
  });

  it('returns an empty set rather than throwing when storage is blocked', () => {
    expect(load(fakeStorage({ readThrows: true })).size).toBe(0);
    expect(load(null).size).toBe(0);
  });
});

describe('save', () => {
  it('reports failure without throwing when the write is refused', () => {
    expect(save(new Set(['13:norris:24']), fakeStorage({ writeThrows: true }))).toBe(false);
    expect(save(new Set(['13:norris:24']), null)).toBe(false);
  });

  it('reports success when the write lands', () => {
    expect(save(new Set(['13:norris:24']), fakeStorage())).toBe(true);
  });
});

describe('dismiss and restore', () => {
  it('does not mutate the set it was given', () => {
    const before = new Set(['13:norris:24']);
    const after = dismiss(before, '13:norris:31');
    expect([...before]).toEqual(['13:norris:24']);
    expect(after.size).toBe(2);
  });

  it('restores one lap and leaves the rest dismissed', () => {
    const keys = dismiss(dismiss(new Set(), '13:norris:24'), '13:norris:31');
    expect([...restore(keys, '13:norris:24')]).toEqual(['13:norris:31']);
  });

  it('dismissing the same lap twice is the same as once', () => {
    const once = dismiss(new Set(), '13:norris:24');
    expect(dismiss(once, '13:norris:24').size).toBe(1);
  });
});

describe('restoreAll', () => {
  it('clears this driver in this round and nothing else', () => {
    const keys = new Set(['13:norris:24', '13:norris:31', '13:piastri:24', '12:norris:24']);
    const next = restoreAll(keys, 13, 'norris');
    expect([...next].sort()).toEqual(['12:norris:24', '13:piastri:24']);
  });
});

describe('partition', () => {
  const flagged = [{ lap: 24 }, { lap: 31 }, { lap: 40 }];

  it('shows everything when nothing is dismissed', () => {
    const { showing, hidden } = partition(flagged, new Set(), 13, 'norris');
    expect(showing).toHaveLength(3);
    expect(hidden).toHaveLength(0);
  });

  it('moves a dismissed lap across and keeps the order of both sides', () => {
    const keys = new Set([flagKey(13, 'norris', 31)]);
    const { showing, hidden } = partition(flagged, keys, 13, 'norris');
    expect(showing.map((f) => f.lap)).toEqual([24, 40]);
    expect(hidden.map((f) => f.lap)).toEqual([31]);
  });

  it('does not hide the same lap number in another race', () => {
    const keys = new Set([flagKey(12, 'norris', 31)]);
    const { hidden } = partition(flagged, keys, 13, 'norris');
    expect(hidden).toHaveLength(0);
  });
});
