import { describe, it, expect } from 'vitest';
import { flagTones } from './flags.js';

describe('flagTones', () => {
  it('maps the flags the feed actually publishes', () => {
    expect(flagTones('YELLOW')).toEqual({ tone: 'yellow' });
    expect(flagTones('BLUE')).toEqual({ tone: 'blue' });
    expect(flagTones('DOUBLE YELLOW').tone).toBe('yellow');
  });

  it('keeps two-tone flags two-tone', () => {
    // A black-and-white flag drawn in one colour is a grey flag, which is
    // not a flag.
    expect(flagTones('BLACK AND WHITE')).toEqual({ tone: 'black', second: 'white' });
    expect(flagTones('CHEQUERED').second).toBe('white');
  });

  it('is case- and whitespace-insensitive, because the feed is not tidy', () => {
    expect(flagTones(' double yellow ')).toEqual(flagTones('DOUBLE YELLOW'));
  });

  it('returns null rather than guessing a colour for an unknown flag', () => {
    expect(flagTones('PURPLE SPOTTED')).toBeNull();
    expect(flagTones(undefined)).toBeNull();
    expect(flagTones(null)).toBeNull();
  });
});
