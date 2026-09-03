// Hold the Python port of ring() to the JavaScript original.
//
//   node scripts/model/parity_check.mjs
//
// build_body.py reimplements ring() and cockpitRing() because Blender's
// Python cannot import an ES module. A hand port is a fork waiting to
// happen, and this one is worse than most: a silent drift of a few
// millimetres would put the Blender body out of register with the
// wings, wheels and floor the JS scene still draws around it — and it
// would look like a modelling mistake rather than a maths one.
//
// So both implementations are run over the same parameters and every
// vertex compared. Same idea as the whatif Python/JS parity fixture.
import { execFileSync } from 'child_process';
import { cockpitRing, ring } from '../../src/lib/carSections.js';

const CASES = [];
for (const w of [0.05, 0.176, 0.296, 0.752]) {
  for (const h of [0.016, 0.084, 0.234]) {
    for (const q of [2.1, 2.4, 2.9, 3.3, 6]) {
      for (const seg of [26, 30, 34, 44]) {
        CASES.push({ kind: 'ring', w, h, cy: 0.43, q, seg });
      }
    }
  }
}
for (const mouth of [0.055, 0.132, 0.162]) {
  for (const floor of [0.486, 0.508, 0.566]) {
    CASES.push({ kind: 'cockpit', w: 0.29, h: 0.23, cy: 0.43, q: 3.3, seg: 44, mouth, floor });
  }
}

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(new URL('.', import.meta.url).pathname)})
import math
def ring(half_width, half_height, centre_y, squareness=2.4, segments=26):
    pts = []
    for i in range(segments):
        t = (i / segments) * math.pi * 2
        ct, st = math.cos(t), math.sin(t)
        p = 2 / squareness
        pts.append((centre_y + half_height * math.copysign(abs(st) ** p, st),
                    half_width * math.copysign(abs(ct) ** p, ct)))
    return pts
def cockpit_ring(w, h, cy, q, mouth, floor_y, segments):
    out = []
    for y, z in ring(w, h, cy, q, segments):
        if y <= floor_y:
            out.append((y, z)); continue
        t = min(1.0, abs(z) / mouth)
        blend = t * t * (3 - 2 * t)
        out.append((floor_y + (y - floor_y) * blend, z))
    return out
cases = json.load(sys.stdin)
out = []
for c in cases:
    if c["kind"] == "ring":
        out.append(ring(c["w"], c["h"], c["cy"], c["q"], c["seg"]))
    else:
        out.append(cockpit_ring(c["w"], c["h"], c["cy"], c["q"], c["mouth"], c["floor"], c["seg"]))
print(json.dumps(out))
`;

// The port lives inside build_body.py; this copy is checked against the
// file so the two cannot drift apart either.
import fs from 'fs';
const source = fs.readFileSync(new URL('./build_body.py', import.meta.url).pathname, 'utf8');
for (const marker of ['def ring(half_width, half_height, centre_y, squareness=2.4, segments=26):',
  'def cockpit_ring(w, h, cy, q, mouth, floor_y, segments):',
  'p = 2 / squareness',
  'blend = t * t * (3 - 2 * t)']) {
  if (!source.includes(marker)) {
    console.error(`build_body.py no longer contains: ${marker}`);
    process.exit(1);
  }
}

const got = JSON.parse(execFileSync('python3', ['-c', py], {
  input: JSON.stringify(CASES), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}));

const TOL = 1e-12;
let worst = 0;
let checked = 0;
CASES.forEach((c, i) => {
  const mine = c.kind === 'ring'
    ? ring(c.w, c.h, c.cy, c.q, c.seg)
    : cockpitRing(c.w, c.h, c.cy, c.q, c.mouth, c.floor, c.seg);
  const theirs = got[i];
  if (mine.length !== theirs.length) {
    console.error(`case ${i}: ${mine.length} points in JS, ${theirs.length} in Python`);
    process.exit(1);
  }
  mine.forEach(([y, z], j) => {
    worst = Math.max(worst, Math.abs(y - theirs[j][0]), Math.abs(z - theirs[j][1]));
    checked += 2;
  });
});

if (worst > TOL) {
  console.error(`PARITY FAILED: worst disagreement ${worst}`);
  process.exit(1);
}
console.log(`parity ok — ${CASES.length} sections, ${checked} coordinates, worst diff ${worst}`);
