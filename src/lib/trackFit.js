/* Fit a circuit's outline to a box shaped like the circuit.
 *
 * The map used to be drawn into a fixed 640×640 square whatever the
 * track was. Circuits are not square. Measured on Monza — a long thin
 * rectangle of a circuit — the drawn path filled 88% of the box's height
 * and 51% of its width, so nearly half the page's largest element was
 * empty, and the track itself was drawn at roughly half the size the
 * space allowed.
 *
 * So the box takes the track's own proportions: the long side is fixed
 * and the short side follows. A tall circuit gets a tall box, a wide one
 * gets a wide box, and in both the track is drawn as large as the space
 * allows.
 *
 * Two things this has to get right.
 *
 * The extent is measured over every point that will be drawn, not just
 * the outline. The Racing Lines page passes driven laps over the same
 * map, and a driven lap leaves the outline's extent — a wide entry, a
 * kerb, an off — so fitting to the outline alone would clip exactly the
 * moments worth looking at. With a 40px pad in a square box that slack
 * was hidden; in a box fitted tightly it would not be.
 *
 * And the aspect is clamped. A street circuit can be long and thin
 * enough that honouring it exactly leaves a 90px-tall ribbon that no
 * corner marker fits inside, so the box is never allowed past 2:1. Past
 * that the track goes back to having space around it, which is the
 * lesser fault.
 */

export const MAX_ASPECT = 2;

/** The extent covering every set of [x, y] points that will be drawn. */
export function extentOf(...pointSets) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const points of pointSets) {
    for (const p of points ?? []) {
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * A box shaped like the track, and the projection into it.
 *
 * `long` is the length of the box's longer side in user units.
 */
export function fitBox(extent, { long = 640, pad = 28, maxAspect = MAX_ASPECT } = {}) {
  if (!extent) return null;
  // A single point, or a track with no extent in one axis, would divide
  // by zero below; give it something square to sit in.
  const spanX = Math.max(extent.maxX - extent.minX, 1e-6);
  const spanY = Math.max(extent.maxY - extent.minY, 1e-6);

  let ratio = spanX / spanY;
  ratio = Math.min(Math.max(ratio, 1 / maxAspect), maxAspect);

  const width = ratio >= 1 ? long : Math.round(long * ratio);
  const height = ratio >= 1 ? Math.round(long / ratio) : long;

  // Uniform scale: a circuit drawn to different scales in x and y is a
  // different circuit.
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);

  // Centre whatever the clamp left over, so a track wider than 2:1 sits
  // in the middle of its box rather than against one edge.
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  return {
    width,
    height,
    scale,
    // y is flipped: the data is metres north, the screen counts down.
    project: ([x, y]) => [
      offsetX + (x - extent.minX) * scale,
      height - offsetY - (y - extent.minY) * scale,
    ],
  };
}
