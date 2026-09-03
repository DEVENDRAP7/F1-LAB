// The car's body, as numbers.
//
// These tables used to live inside the Three.js scene builder, which was
// fine while the scene was the only thing that drew them. It is not any
// more: there is a Blender pipeline that lofts the same body with
// subdivision surfaces, and two copies of a section table is the kind of
// duplication that is correct on the day it is written and wrong a month
// later. One file, two consumers — the JS scene imports it directly, and
// scripts/model/dump_sections.mjs writes it out as JSON for Blender.
//
// Units are metres, x runs nose-negative to tail-positive, y is up, z is
// across the car. `q` is the superellipse exponent: 2 is an ellipse and
// larger is squarer.

export const NOSE = [
  { x: -2.60, w: 0.050, h: 0.044, cy: 0.290, q: 2.6 },
  { x: -2.48, w: 0.064, h: 0.054, cy: 0.296, q: 2.5 },
  { x: -2.24, w: 0.082, h: 0.068, cy: 0.310, q: 2.4 },
  { x: -1.92, w: 0.100, h: 0.084, cy: 0.334, q: 2.4 },
  { x: -1.56, w: 0.118, h: 0.100, cy: 0.358, q: 2.5 },
  { x: -1.26, w: 0.134, h: 0.114, cy: 0.376, q: 2.6 },
  { x: -1.06, w: 0.146, h: 0.124, cy: 0.386, q: 2.7 },
];

/** Segments the tub is lofted at: it carries the cockpit trough, which
 *  needs more resolution than a plain section to stay smooth. */
export const TUB_SEG = 44;

// Stations carrying `mouth` and `floor` have the cockpit trough pressed
// into them. It opens narrow ahead of the driver, is deepest and widest
// at the seat, and closes again before the headrest.
export const TUB = [
  { x: -1.18, w: 0.176, h: 0.140, cy: 0.386, q: 2.9 },
  { x: -1.02, w: 0.224, h: 0.166, cy: 0.394, q: 3.0 },
  { x: -0.84, w: 0.252, h: 0.184, cy: 0.400, q: 3.0 },
  { x: -0.52, w: 0.274, h: 0.212, cy: 0.418, q: 3.1 },
  { x: -0.46, w: 0.278, h: 0.216, cy: 0.420, q: 3.1, mouth: 0.055, floor: 0.566 },
  { x: -0.34, w: 0.284, h: 0.222, cy: 0.424, q: 3.2, mouth: 0.132, floor: 0.508 },
  { x: -0.18, w: 0.292, h: 0.228, cy: 0.428, q: 3.3, mouth: 0.162, floor: 0.486 },
  { x: 0.02, w: 0.294, h: 0.232, cy: 0.430, q: 3.3, mouth: 0.158, floor: 0.490 },
  { x: 0.12, w: 0.295, h: 0.233, cy: 0.431, q: 3.3, mouth: 0.086, floor: 0.552 },
  { x: 0.16, w: 0.296, h: 0.234, cy: 0.432, q: 3.3 },
  { x: 0.50, w: 0.286, h: 0.232, cy: 0.436, q: 3.2 },
  { x: 0.86, w: 0.252, h: 0.216, cy: 0.430, q: 3.0 },
  { x: 1.18, w: 0.205, h: 0.186, cy: 0.412, q: 2.8 },
  { x: 1.46, w: 0.152, h: 0.158, cy: 0.396, q: 2.6 },
];

export const COVER = [
  { x: 0.08, w: 0.084, h: 0.090, cy: 0.808, q: 2.3 },
  { x: 0.18, w: 0.100, h: 0.108, cy: 0.792, q: 2.2 },
  { x: 0.32, w: 0.130, h: 0.136, cy: 0.754, q: 2.1 },
  { x: 0.50, w: 0.158, h: 0.152, cy: 0.712, q: 2.1 },
  { x: 0.72, w: 0.168, h: 0.144, cy: 0.664, q: 2.3 },
  { x: 0.94, w: 0.160, h: 0.130, cy: 0.614, q: 2.5 },
  { x: 1.22, w: 0.130, h: 0.108, cy: 0.556, q: 2.6 },
  { x: 1.52, w: 0.094, h: 0.084, cy: 0.500, q: 2.5 },
  { x: 1.84, w: 0.058, h: 0.056, cy: 0.448, q: 2.4 },
  { x: 2.14, w: 0.034, h: 0.038, cy: 0.414, q: 2.3 },
];

export const POD = [
  { x: -0.62, w: 0.030, h: 0.092, cy: 0.300, z: 0.505 },
  { x: -0.46, w: 0.112, h: 0.134, cy: 0.302, z: 0.516 },
  { x: -0.14, w: 0.152, h: 0.150, cy: 0.308, z: 0.528 },
  { x: 0.24, w: 0.154, h: 0.144, cy: 0.314, z: 0.520 },
  { x: 0.62, w: 0.132, h: 0.128, cy: 0.324, z: 0.480 },
  { x: 1.00, w: 0.096, h: 0.104, cy: 0.338, z: 0.400 },
  { x: 1.34, w: 0.056, h: 0.076, cy: 0.354, z: 0.302 },
  { x: 1.60, w: 0.026, h: 0.046, cy: 0.368, z: 0.224 },
];

export const POD_Q = 2.9;

export const FLOOR = [
  { x: -1.95, w: 0.150, h: 0.016, cy: 0.075 },
  { x: -1.55, w: 0.400, h: 0.018, cy: 0.072 },
  { x: -1.05, w: 0.620, h: 0.020, cy: 0.070 },
  { x: -0.40, w: 0.735, h: 0.022, cy: 0.068 },
  { x: 0.35, w: 0.752, h: 0.022, cy: 0.068 },
  { x: 1.00, w: 0.720, h: 0.022, cy: 0.072 },
  { x: 1.45, w: 0.640, h: 0.024, cy: 0.086 },
  { x: 1.80, w: 0.560, h: 0.030, cy: 0.118 },
  { x: 2.08, w: 0.492, h: 0.038, cy: 0.166 },
  { x: 2.26, w: 0.460, h: 0.044, cy: 0.206 },
];

/** A superellipse ring in the (y, z) plane, as [y, z] pairs.
 *
 *  Ported line for line into scripts/model/build_body.py; the two are
 *  held to agreement by scripts/model/parity_check.mjs, because a
 *  Blender body built from a slightly different section would drift
 *  away from the parts the JS scene still draws around it. */
export function ring(halfWidth, halfHeight, centreY, squareness = 2.4, segments = 26) {
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const p = 2 / squareness;
    pts.push([
      centreY + halfHeight * Math.sign(st) * Math.abs(st) ** p,
      halfWidth * Math.sign(ct) * Math.abs(ct) ** p,
    ]);
  }
  return pts;
}

/** The cockpit trough, pressed into a section's top surface. */
export function cockpitRing(w, h, cy, q, mouth, floorY, segments) {
  return ring(w, h, cy, q, segments).map(([y, z]) => {
    if (y <= floorY) return [y, z];
    const t = Math.min(1, Math.abs(z) / mouth);
    const blend = t * t * (3 - 2 * t);
    return [floorY + (y - floorY) * blend, z];
  });
}
