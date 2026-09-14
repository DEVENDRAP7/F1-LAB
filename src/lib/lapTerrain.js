/* The driven lap as geometry in three dimensions.
 *
 * Every 2D map on this site draws x and y and throws z away. The
 * position feed publishes all three — see the `z` channel in any
 * lines/manifest.json — and the elevation it carries is real and
 * substantial: 102.4 m over a lap of Spa, 63.4 m at Austin, against
 * 12.6 m at Monza. That range is the one thing a flat outline cannot
 * show, and it is the only reason this module exists. 3D here is not a
 * style; it is the third published channel finally being drawn.
 *
 * This module is pure maths and knows nothing about three.js or the DOM,
 * so the projection, the exaggeration and the vertex winding can all be
 * tested without a GPU. lapSceneThree.js turns what comes out of here
 * into buffers.
 *
 *
 * WHAT IS DRAWN, AND WHAT IS A DRAWING CHOICE
 *
 * Measured, straight from the feed: the path's x, y and z, and the speed
 * at every sample.
 *
 * Chosen, and labelled as chosen wherever it is shown:
 *
 *   - The vertical exaggeration. See VERTICAL_EXAGGERATION below for how
 *     the number was picked and why it is one number for every circuit.
 *
 *   - The tube's radius. The feed gives a driven LINE, not a track
 *     width, so the tube is a drawn line weight and deliberately far
 *     thinner than a real track: a ribbon at anything near 12 m would
 *     invite a reader to measure a road that was never published. The
 *     radius is in screen-ish world units, not metres, for the same
 *     reason.
 *
 *   - The datum. Elevation is relative to the feed's own zero, not to
 *     sea level (the manifest says so), so the curtain hangs from the
 *     path down to the lowest point OF THIS LAP. The curtain's height is
 *     therefore height-above-the-lap's-lowest-point, which is a real
 *     quantity; the plane it lands on is not sea level and is never
 *     labelled as an altitude.
 */

/* One factor, every circuit.
 *
 * Relief as a fraction of the lap's own horizontal span, measured over
 * the twelve laps that publish a usable elevation channel: 0.25% at the
 * flattest, 1.48% median, 5.08% at Spa. Drawn true to scale the median
 * circuit's whole elevation profile is one and a half percent of the
 * frame, which is indistinguishable from a printing error.
 *
 * The alternative — fitting each circuit's relief to the same screen
 * height — was rejected outright: it would draw Monza and Spa as equally
 * hilly, which is a lie about the only quantity the view exists to show.
 *
 * So: one constant, applied to every circuit, stated on screen. At x6
 * the median circuit's relief reaches ~9% of its span, which reads as
 * terrain, and the steepest stays at ~30%, which still reads as a
 * circuit rather than a wall. Relative relief is exact — Spa is drawn
 * twenty times hillier than the flattest lap because it is twenty times
 * hillier. */
export const VERTICAL_EXAGGERATION = 6;

/* Speed bands, identical to the Racing Lines channel map's own edges
 * (see COLOUR_CHANNELS.speed there). Reused rather than re-picked so
 * that a colour means the same speed on both pages; two different band
 * sets in the same ramp would be two scales in one language. */
export const SPEED_BAND_EDGES = [100, 175, 235, 290];

/** Which band a speed falls in: 0 for the slowest, edges.length for the fastest. */
export function speedBand(kph, edges = SPEED_BAND_EDGES) {
  let band = 0;
  while (band < edges.length && kph >= edges[band]) band += 1;
  return band;
}

/**
 * Decode a lap's channels into metres and km/h.
 *
 * The .bin files are int16 and the divisor is per-channel and read from
 * the manifest, never assumed — see racingLine.js. Samples missing any
 * of x, y or z are dropped rather than interpolated: a gap in the
 * position feed is a gap, and joining across it would draw a straight
 * line through scenery the car went round.
 */
export function decodeLapPath(channels, scale) {
  const n = channels.x?.length ?? 0;
  const x = [];
  const y = [];
  const z = [];
  const speed = [];
  for (let i = 0; i < n; i++) {
    const px = channels.x[i] / scale.x;
    const py = channels.y[i] / scale.y;
    const pz = channels.z ? channels.z[i] / (scale.z ?? 10) : 0;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
    x.push(px);
    y.push(py);
    z.push(pz);
    speed.push(channels.speed ? channels.speed[i] / (scale.speed ?? 10) : 0);
  }
  return {
    x: Float32Array.from(x),
    y: Float32Array.from(y),
    z: Float32Array.from(z),
    speed: Float32Array.from(speed),
    count: x.length,
  };
}

/** The lap's bounding box in metres, plus its spans. */
export function lapExtent(path) {
  if (!path?.count) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < path.count; i++) {
    if (path.x[i] < minX) minX = path.x[i];
    if (path.x[i] > maxX) maxX = path.x[i];
    if (path.y[i] < minY) minY = path.y[i];
    if (path.y[i] > maxY) maxY = path.y[i];
    if (path.z[i] < minZ) minZ = path.z[i];
    if (path.z[i] > maxZ) maxZ = path.z[i];
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    spanX: maxX - minX,
    spanY: maxY - minY,
    spanZ: maxZ - minZ,
  };
}

/**
 * The projection from metres into the scene's world units.
 *
 * One horizontal scale for x and y, because a circuit drawn to two
 * different horizontal scales is a different circuit. z gets that same
 * scale multiplied by the exaggeration — which is what makes the
 * exaggeration the single, statable distortion in the view rather than
 * one of several.
 *
 * The lap is centred on its own extent in x and y, and sits with its
 * lowest point at y=0 in the scene, so the datum plane is the floor.
 *
 * Scene axes: three.js is y-up, so the circuit's x/y plane becomes the
 * scene's x/z plane and the circuit's z (elevation) becomes scene y.
 * `project` returns [sceneX, sceneY, sceneZ] to keep that conversion in
 * exactly one place.
 */
export function lapProjection(extent, { worldSize = 100, exaggeration = VERTICAL_EXAGGERATION } = {}) {
  if (!extent) return null;
  const spanH = Math.max(extent.spanX, extent.spanY, 1e-6);
  const scale = worldSize / spanH;
  const midX = (extent.minX + extent.maxX) / 2;
  const midY = (extent.minY + extent.maxY) / 2;
  return {
    scale,
    exaggeration,
    /** Height of the whole relief in world units, after exaggeration. */
    reliefWorld: extent.spanZ * scale * exaggeration,
    project: (x, y, z) => [
      (x - midX) * scale,
      (z - extent.minZ) * scale * exaggeration,
      // Negated so the circuit is not mirrored: the data's +y is north,
      // and scene -z is into the screen, which is where north should go.
      -(y - midY) * scale,
    ],
  };
}

/* The drawn line weight, in world units — not metres. See the header on
 * why this is deliberately nothing like a track width. */
export const TUBE_RADIUS = 0.62;

/**
 * A closed tube of square cross-section following the path.
 *
 * Four vertices per sample, so the line reads as a line from any camera
 * angle — a flat ribbon in the horizontal plane vanishes when viewed
 * edge-on, which at a low camera is most of the time.
 *
 * The cross-section is oriented from the path's own tangent: `right` is
 * the tangent crossed with world up, and `up` is `right` crossed back
 * with the tangent, so the tube twists with the path instead of shearing
 * where it climbs.
 *
 * Returns position/normal/band buffers and an index buffer. `band` is
 * per-vertex so the fragment stage can pick a colour without a second
 * draw call per band.
 */
export function buildLapTube(path, projection, { radius = TUBE_RADIUS, edges = SPEED_BAND_EDGES } = {}) {
  const n = path.count;
  if (!n || !projection) return null;

  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [px, py, pz] = projection.project(path.x[i], path.y[i], path.z[i]);
    pts[i * 3] = px;
    pts[i * 3 + 1] = py;
    pts[i * 3 + 2] = pz;
  }

  const RING = 4;
  const positions = new Float32Array(n * RING * 3);
  const normals = new Float32Array(n * RING * 3);
  const bands = new Float32Array(n * RING);

  // The square's corners, as (right, up) multipliers.
  const corners = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];

  for (let i = 0; i < n; i++) {
    // Central difference on a closed loop, so the tangent at the
    // start/finish line is as good as anywhere else.
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    let tx = pts[b * 3] - pts[a * 3];
    let ty = pts[b * 3 + 1] - pts[a * 3 + 1];
    let tz = pts[b * 3 + 2] - pts[a * 3 + 2];
    let tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;

    // right = tangent x up(0,1,0)
    let rx = tz;
    let ry = 0;
    let rz = -tx;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-6) {
      // Tangent is vertical — impossible on a circuit, but a degenerate
      // duplicated sample can make it so. Any perpendicular will do.
      rx = 1;
      ry = 0;
      rz = 0;
      rl = 1;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;

    // up = right x tangent
    const ux = ry * tz - rz * ty;
    const uy = rz * tx - rx * tz;
    const uz = rx * ty - ry * tx;

    const band = speedBand(path.speed[i], edges);
    for (let c = 0; c < RING; c++) {
      const [mr, mu] = corners[c];
      const nx = rx * mr + ux * mu;
      const ny = ry * mr + uy * mu;
      const nz = rz * mr + uz * mu;
      const o = (i * RING + c) * 3;
      positions[o] = pts[i * 3] + nx * radius;
      positions[o + 1] = pts[i * 3 + 1] + ny * radius;
      positions[o + 2] = pts[i * 3 + 2] + nz * radius;
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
      bands[i * RING + c] = band;
    }
  }

  // Two triangles per quad, n quads round the loop (it closes).
  const indices = new Uint32Array(n * RING * 6);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    for (let c = 0; c < RING; c++) {
      const c2 = (c + 1) % RING;
      const v00 = i * RING + c;
      const v01 = i * RING + c2;
      const v10 = next * RING + c;
      const v11 = next * RING + c2;
      indices[k++] = v00;
      indices[k++] = v10;
      indices[k++] = v11;
      indices[k++] = v00;
      indices[k++] = v11;
      indices[k++] = v01;
    }
  }

  return { positions, normals, bands, indices, centreline: pts, count: n };
}

/**
 * The curtain: a vertical sheet from the path down to the datum plane.
 *
 * This is what makes the elevation readable. A line floating in space
 * reads as a line; the same line with a sheet hung beneath it reads as a
 * profile, and its height at any point is the height of the car above
 * the lowest point of the lap.
 *
 * Two vertices per sample — one on the path, one directly below it on
 * the floor — wound into a closed strip. `height` is per-vertex and
 * normalised 0..1 over the lap's own relief, so the shader can fade the
 * sheet out towards the floor without needing the extent.
 */
export function buildLapCurtain(path, projection) {
  const n = path.count;
  if (!n || !projection) return null;

  const positions = new Float32Array(n * 2 * 3);
  const heights = new Float32Array(n * 2);
  let maxY = 0;
  for (let i = 0; i < n; i++) {
    const [px, py, pz] = projection.project(path.x[i], path.y[i], path.z[i]);
    positions[i * 6] = px;
    positions[i * 6 + 1] = py;
    positions[i * 6 + 2] = pz;
    positions[i * 6 + 3] = px;
    positions[i * 6 + 4] = 0;
    positions[i * 6 + 5] = pz;
    if (py > maxY) maxY = py;
  }
  const span = maxY || 1;
  for (let i = 0; i < n; i++) {
    heights[i * 2] = positions[i * 6 + 1] / span;
    heights[i * 2 + 1] = 0;
  }

  const indices = new Uint32Array(n * 6);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const top = i * 2;
    const bottom = i * 2 + 1;
    const nextTop = next * 2;
    const nextBottom = next * 2 + 1;
    indices[k++] = top;
    indices[k++] = bottom;
    indices[k++] = nextBottom;
    indices[k++] = top;
    indices[k++] = nextBottom;
    indices[k++] = nextTop;
  }

  return { positions, heights, indices, count: n };
}

/* How far off axis the opening view sits.
 *
 * Not zero: a circuit viewed square-on to its own long axis renders as
 * an elevation drawing, and the whole point of this view is that it is
 * not one. About twenty degrees is enough for the near and far sides to
 * separate and the relief to read as depth. */
export const OPENING_SKEW = 0.36;

/**
 * The yaw to open on, from the circuit's own proportions.
 *
 * This was a fixed angle, and fixed is wrong because circuits do not
 * share an orientation. Spa runs north-south and Monza east-west, so one
 * angle puts one of them broadside and the other nearly end-on — and
 * end-on, its long axis runs INTO the screen, where it costs depth
 * instead of width. Measured on Spa at the old fixed 29 degrees: the lap
 * occupied about a third of the frame's width while the camera sat back
 * far enough to contain 100 world units of depth nobody could see.
 *
 * So the longer horizontal axis is turned across the screen, which is
 * the axis the frame has most of. The camera's right vector at yaw is
 * (cos yaw, 0, -sin yaw), so a lap that is longest in scene x wants yaw
 * near 0 and one longest in scene z wants yaw near a quarter turn.
 *
 * Remember that the projection maps the data's y onto scene z, so it is
 * extent.spanY that decides whether the quarter turn is wanted.
 */
export function openingYaw(extent, { skew = OPENING_SKEW } = {}) {
  if (!extent) return 0;
  const longestIsSceneZ = extent.spanY > extent.spanX;
  return (longestIsSceneZ ? Math.PI / 2 : 0) + skew;
}

/**
 * How far back the camera has to sit to hold the whole lap.
 *
 * The first version of this fitted a bounding SPHERE to the vertical
 * field of view, which is the textbook trick and was wrong here by a
 * factor of about three. A lap is a wide, nearly flat loop, and the
 * frame it sits in is around 2.8:1 — so a sphere big enough to contain
 * the loop's width, fitted to the SHORT axis of the frame, pushed the
 * camera far enough back that Monza filled under a third of the picture.
 *
 * So this fits the actual points, against both axes, for the camera
 * direction actually in use.
 *
 * For each point, taken relative to the target and resolved onto the
 * camera's own right/up/forward basis, the camera at distance D sees it
 * at depth D - f. To keep it inside the frustum:
 *
 *     |r| <= tan(fovH/2) * (D - f)   and   |u| <= tan(fovV/2) * (D - f)
 *
 * which rearranges to a minimum D per point per axis, and the answer is
 * the largest of them. `fill` then leaves a margin: 1 is the lap exactly
 * touching the frame edges, 0.88 leaves a little air.
 *
 * Every point is tested rather than the bounding box's corners, because
 * the corners of a box around a circuit are empty space — that is the
 * same over-estimate as the sphere, just smaller.
 */
export function fitDistance(points, count, target, { yaw, pitch, fovDeg = 42, aspect = 2, fill = 0.88 }) {
  if (!count) return null;
  const fovV = (fovDeg * Math.PI) / 180;
  const tanV = Math.tan(fovV / 2);
  const tanH = tanV * aspect;

  // The camera's basis for this yaw/pitch. `forward` points from the
  // target towards the camera, matching how the scene places it.
  const fx = Math.cos(pitch) * Math.sin(yaw);
  const fy = Math.sin(pitch);
  const fz = Math.cos(pitch) * Math.cos(yaw);
  // right = normalise(forward x worldUp) — horizontal, so screen-level.
  const rl = Math.hypot(fz, 0, -fx) || 1;
  const rx = fz / rl;
  const rz = -fx / rl;
  // up = right x forward
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;

  let distance = 0;
  for (let i = 0; i < count; i++) {
    const px = points[i * 3] - target[0];
    const py = points[i * 3 + 1] - target[1];
    const pz = points[i * 3 + 2] - target[2];
    const f = px * fx + py * fy + pz * fz;
    const r = Math.abs(px * rx + pz * rz);
    const u = Math.abs(px * ux + py * uy + pz * uz);
    const needH = f + r / tanH;
    const needV = f + u / tanV;
    if (needH > distance) distance = needH;
    if (needV > distance) distance = needV;
  }
  return distance / fill;
}
