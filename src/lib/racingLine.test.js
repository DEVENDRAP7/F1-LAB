import { describe, expect, it } from 'vitest';
import { lineToMapPoints, loadRacingLine } from './racingLine.js';

// The pipeline packs channels interleaved in manifest.channels order
// (pipeline/common.py: LINE_CHANNELS) with a per-driver point count —
// these tests pin the JS decoder to that exact layout so a change on
// either side of the contract is caught immediately instead of silently
// misreading every racing line.
describe('loadRacingLine', () => {
  const manifest = {
    channels: ['x', 'y', 'speed'],
    scale: { x: 10, y: 10, speed: 10 },
    drivers: { HAM: { pointCount: 3 } },
  };

  it('de-interleaves a raw Int16 buffer into named channels per the manifest', async () => {
    // point0: x=0 y=100 speed=2500 ; point1: x=10 y=110 speed=2510 ; point2: x=20 y=120 speed=2520
    const raw = new Int16Array([0, 100, 2500, 10, 110, 2510, 20, 120, 2520]);

    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => raw.buffer,
    });

    const channels = await loadRacingLine('1', 'Q', 'HAM', manifest);

    expect(Array.from(channels.x)).toEqual([0, 10, 20]);
    expect(Array.from(channels.y)).toEqual([100, 110, 120]);
    expect(Array.from(channels.speed)).toEqual([2500, 2510, 2520]);
  });

  it('rejects a buffer whose size disagrees with the manifest', async () => {
    const raw = new Int16Array([0, 100, 2500, 10]); // truncated
    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => raw.buffer,
    });

    await expect(loadRacingLine('1', 'Q', 'HAM', manifest)).rejects.toThrow(/manifest declares/);
  });

  it('throws for a driver the manifest does not list', async () => {
    await expect(loadRacingLine('1', 'Q', 'ALO', manifest)).rejects.toThrow(/not listed/);
  });

  it('throws with the driver code and status on a missing file', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    await expect(loadRacingLine('1', 'Q', 'HAM', manifest)).rejects.toThrow(/HAM.*404/);
  });
});

describe('lineToMapPoints', () => {
  it('converts decimetre ints to metre pairs using the manifest scale', () => {
    const points = lineToMapPoints(
      { x: new Int16Array([0, 10, 25]), y: new Int16Array([100, 110, 120]) },
      { x: 10, y: 10 },
    );
    expect(points).toEqual([
      [0, 10],
      [1, 11],
      [2.5, 12],
    ]);
  });
});
