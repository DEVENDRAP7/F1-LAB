import { describe, expect, it } from 'vitest';
import { loadRacingLine } from './racingLine.js';

// The pipeline packs channels interleaved in manifest.channels order
// (pipeline/common.py: LINE_CHANNELS) — this test pins the JS decoder to
// that exact layout so a change on either side of the contract is caught
// immediately instead of silently misreading every racing line.
describe('loadRacingLine', () => {
  it('de-interleaves a raw Int16 buffer into named channels per the manifest', async () => {
    const manifest = {
      pointCount: 3,
      channels: ['x', 'y', 'speed'],
      scale: { x: 10, y: 10, speed: 10 },
    };

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

  it('throws with the driver code and status on a missing file', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    await expect(
      loadRacingLine('1', 'Q', 'HAM', { pointCount: 1, channels: ['x'], scale: { x: 10 } }),
    ).rejects.toThrow(/HAM.*404/);
  });
});
