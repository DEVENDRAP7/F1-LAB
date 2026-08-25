import { describe, expect, it } from 'vitest';
import { driverCode, driverIndex, driverName, prettyId } from './driverNames.js';

const ENTRIES = [
  { code: 'VER', driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' },
  { code: 'LIN', driverId: 'arvid_lindblad', givenName: 'Arvid', familyName: 'Lindblad' },
  { code: 'LEC', driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc' },
];

describe('driver identity', () => {
  it('uses the published code, not a truncation of the id', () => {
    const index = driverIndex(ENTRIES);
    // slice(0, 3) gave MAX and ARV — plausible-looking and wrong.
    expect(driverCode(index, 'max_verstappen')).toBe('VER');
    expect(driverCode(index, 'arvid_lindblad')).toBe('LIN');
    expect(driverCode(index, 'leclerc')).toBe('LEC');
  });

  it('gives the full name from the entry list', () => {
    const index = driverIndex(ENTRIES);
    expect(driverName(index, 'max_verstappen')).toBe('Max Verstappen');
  });

  it('falls back readably rather than to a fake code', () => {
    const index = driverIndex(ENTRIES);
    const missing = driverCode(index, 'someone_new');
    expect(missing).toBe('Someone New');
    // A fallback must not masquerade as a real three-letter code.
    expect(missing).not.toMatch(/^[A-Z]{3}$/);
  });

  it('prettifies an id with no entry', () => {
    expect(prettyId('max_verstappen')).toBe('Max Verstappen');
    expect(prettyId(null)).toBe('—');
  });
});
