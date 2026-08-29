import { describe, expect, it } from 'vitest';
import { PARTS, VERDICT_LABEL, WHOLE_CAR, partInfo } from './aeroRigParts.js';

describe('PARTS', () => {
  it('gives every part a name, text and a verdict the label dict covers', () => {
    for (const [key, spec] of Object.entries(PARTS)) {
      expect(spec.name, key).toBeTruthy();
      expect(spec.text, key).toBeTruthy();
      const [kind, note] = spec.verdict;
      expect(VERDICT_LABEL[kind], `${key}: unknown verdict kind ${kind}`).toBeTruthy();
      expect(note, key).toBeTruthy();
    }
  });

  it('matches the part keys the scene actually tags', () => {
    // aeroRigScene.js sets mesh.userData.part to one of these strings —
    // a mismatch here means a click on a real mesh finds no description.
    const taggedInScene = [
      'frontWing', 'frontFlap', 'nose', 'floor', 'sidepod', 'halo',
      'airbox', 'rearWing', 'rearFlap', 'diffuser', 'wheel', 'suspension',
    ];
    expect(Object.keys(PARTS).sort()).toEqual(taggedInScene.sort());
  });
});

describe('partInfo', () => {
  it('looks up a known part', () => {
    expect(partInfo('wheel').name).toBe(PARTS.wheel.name);
  });

  it('falls back to the whole-car description for null or an unknown key', () => {
    expect(partInfo(null)).toBe(WHOLE_CAR);
    expect(partInfo(undefined)).toBe(WHOLE_CAR);
    expect(partInfo('not-a-real-part')).toBe(WHOLE_CAR);
  });
});
