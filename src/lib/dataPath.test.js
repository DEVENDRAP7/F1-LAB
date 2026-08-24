import { describe, expect, it } from 'vitest';
import { dataPath } from './dataPath.js';

describe('dataPath', () => {
  it('joins BASE_URL and the relative path without a double slash', () => {
    expect(dataPath('season.json')).toBe('/F1-LAB/data/season.json');
  });

  it('does not resolve against the domain root', () => {
    // A leading '/' would 404 once served from a Pages project path
    // instead of the domain root (docs/SPEC.md 2.2).
    expect(dataPath('season.json')).not.toBe('/data/season.json');
  });

  it('handles nested session paths', () => {
    expect(dataPath('2026/1/Q/lines/manifest.json')).toBe(
      '/F1-LAB/data/2026/1/Q/lines/manifest.json',
    );
  });
});
