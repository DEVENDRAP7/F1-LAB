// Write the body's section tables out as JSON, for the Blender build.
//
// Blender's Python cannot import an ES module, and copying the numbers
// into the Python script would be the fork this whole arrangement
// exists to avoid. So the JS module stays the single source and this
// dumps it; scripts/model/build_body.py reads only the dump.
//
//   node scripts/model/dump_sections.mjs
import fs from 'fs';
import { COVER, FLOOR, NOSE, POD, POD_Q, TUB, TUB_SEG } from '../../src/lib/carSections.js';

const out = new URL('./sections.json', import.meta.url).pathname;
fs.writeFileSync(out, `${JSON.stringify({
  nose: NOSE, tub: TUB, tubSeg: TUB_SEG, cover: COVER, pod: POD, podQ: POD_Q, floor: FLOOR,
}, null, 1)}\n`);
console.log(`wrote ${out}`);
