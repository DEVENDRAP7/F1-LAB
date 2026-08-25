import { describe, expect, it } from 'vitest';
import { formatDelta, formatLapTime, formatDuration } from './formatTime.js';

describe('formatLapTime', () => {
  it('keeps sub-minute times in seconds, as timing screens do', () => {
    expect(formatLapTime(59.812)).toBe('59.812');
    expect(formatLapTime(41.5)).toBe('41.500');
  });

  it('quotes a real lap in the minute form', () => {
    // 79.137 is a Zandvoort lap. It was rendering as "79.137s", which is
    // the number nobody in the sport reads.
    expect(formatLapTime(79.137)).toBe('1:19.137');
  });

  it('quotes a lap past a minute as M:SS.mmm', () => {
    expect(formatLapTime(103.174)).toBe('1:43.174');
    expect(formatLapTime(148.544)).toBe('2:28.544');
  });

  it('pads the seconds so the colon form never reads as 1:4.2', () => {
    expect(formatLapTime(64.2)).toBe('1:04.200');
  });

  it('carries instead of rendering a sixtieth second', () => {
    expect(formatLapTime(119.9996)).toBe('2:00.000');
  });

  it('handles the minute boundary itself', () => {
    expect(formatLapTime(60)).toBe('1:00.000');
  });

  it('returns a dash rather than NaN for missing data', () => {
    expect(formatLapTime(null)).toBe('—');
    expect(formatLapTime(Number.NaN)).toBe('—');
  });
});

describe('formatDelta', () => {
  it('signs a gain and leaves a loss its own minus', () => {
    expect(formatDelta(24.037)).toBe('+24.037');
    expect(formatDelta(-3.5)).toBe('-3.500');
  });

  it('switches a large delta to the minute form too', () => {
    expect(formatDelta(86.542)).toBe('+1:26.542');
  });
});

describe('formatDuration past an hour', () => {
  it('carries the hour so a race time is not read as a lap time', () => {
    // 1:40:14.9 — a real race distance. Quoted as "100:14.9" it reads as
    // a hundred-minute lap, which is what this page shipped first.
    expect(formatDuration(6014.9)).toBe('1:40:14.9');
  });

  it('keeps a two-digit minute after the hour', () => {
    expect(formatDuration(3723.4)).toBe('1:02:03.4');
  });

  it('handles the first minute of an hour without borrowing', () => {
    expect(formatDuration(3600)).toBe('1:00:00.0');
    expect(formatDuration(3612.3)).toBe('1:00:12.3');
  });

  it('leaves anything under an hour in the lap form', () => {
    expect(formatDuration(75.4)).toBe('1:15.4');
    expect(formatDuration(22.31)).toBe('22.3');
  });
});
