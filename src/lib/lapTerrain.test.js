import { describe, expect, it } from 'vitest';
import {
  buildLapCurtain,
  buildLapTube,
  decodeLapPath,
  fitDistance,
  lapExtent,
  lapProjection,
  openingYaw,
  OPENING_SKEW,
  speedBand,
  SPEED_BAND_EDGES,
  VERTICAL_EXAGGERATION,
} from './lapTerrain.js';

const scale = { x: 10, y: 10, z: 10, speed: 10 };

/** A closed square lap that climbs on one side, in decimetre ints. */
function squareLap({ climb = 100 } = {}) {
  const x = [];
  const y = [];
  const z = [];
  const speed = [];
  const push = (mx, my, mz, kph) => {
    x.push(mx * 10);
    y.push(my * 10);
    z.push(mz * 10);
    speed.push(kph * 10);
  };
  const n = 20;
  for (let i = 0; i < n; i++) push((i / n) * 200, 0, 0, 300);
  for (let i = 0; i < n; i++) push(200, (i / n) * 200, (i / n) * climb, 150);
  for (let i = 0; i < n; i++) push(200 - (i / n) * 200, 200, climb, 300);
  for (let i = 0; i < n; i++) push(0, 200 - (i / n) * 200, climb - (i / n) * climb, 150);
  return {
    channels: {
      x: Int16Array.from(x),
      y: Int16Array.from(y),
      z: Int16Array.from(z),
      speed: Int16Array.from(speed),
    },
    scale,
  };
}

/** A long, flat lap — the shape a real circuit actually is in plan. */
function wideLap() {
  const x = [];
  const y = [];
  const z = [];
  const speed = [];
  const push = (mx, my) => {
    x.push(mx * 10);
    y.push(my * 10);
    z.push(20);
    speed.push(2000);
  };
  const n = 24;
  for (let i = 0; i < n; i++) push((i / n) * 800, 0);
  for (let i = 0; i < n; i++) push(800, (i / n) * 200);
  for (let i = 0; i < n; i++) push(800 - (i / n) * 800, 200);
  for (let i = 0; i < n; i++) push(0, 200 - (i / n) * 200);
  return {
    channels: {
      x: Int16Array.from(x),
      y: Int16Array.from(y),
      z: Int16Array.from(z),
      speed: Int16Array.from(speed),
    },
  };
}

describe('speedBand', () => {
  it('puts a speed in the band its edges describe', () => {
    expect(speedBand(80)).toBe(0);
    expect(speedBand(120)).toBe(1);
    expect(speedBand(200)).toBe(2);
    expect(speedBand(250)).toBe(3);
    expect(speedBand(330)).toBe(4);
  });

  it('is inclusive at the low side of each edge, so a band owns its edge', () => {
    expect(speedBand(100)).toBe(1);
    expect(speedBand(99.9)).toBe(0);
  });

  it('never returns a band outside the ramp it has colours for', () => {
    for (const v of [-10, 0, 1e6]) {
      const band = speedBand(v);
      expect(band).toBeGreaterThanOrEqual(0);
      expect(band).toBeLessThanOrEqual(SPEED_BAND_EDGES.length);
    }
  });
});

describe('decodeLapPath', () => {
  it('recovers metres and km/h using the manifest divisors, not assumed ones', () => {
    const { channels } = squareLap();
    const path = decodeLapPath(channels, { x: 10, y: 10, z: 10, speed: 10 });
    expect(path.count).toBe(80);
    expect(path.x[0]).toBeCloseTo(0, 5);
    expect(path.speed[0]).toBeCloseTo(300, 5);
  });

  it('honours a divisor that differs between channels', () => {
    const path = decodeLapPath(
      { x: Int16Array.from([100]), y: Int16Array.from([100]), z: Int16Array.from([100]), speed: Int16Array.from([100]) },
      { x: 10, y: 10, z: 100, speed: 1 },
    );
    expect(path.z[0]).toBeCloseTo(1, 5);
    expect(path.speed[0]).toBeCloseTo(100, 5);
  });

  it('drops a sample with a missing coordinate rather than interpolating over the gap', () => {
    // Joining across a position gap draws a straight line through
    // scenery the car actually went round.
    const path = decodeLapPath(
      {
        x: Float32Array.from([0, NaN, 20]),
        y: Float32Array.from([0, 10, 20]),
        z: Float32Array.from([0, 0, 0]),
        speed: Float32Array.from([100, 100, 100]),
      },
      scale,
    );
    expect(path.count).toBe(2);
  });

  it('survives a lap with no z channel at all', () => {
    const path = decodeLapPath(
      { x: Int16Array.from([0, 10]), y: Int16Array.from([0, 10]), speed: Int16Array.from([0, 0]) },
      scale,
    );
    expect(path.count).toBe(2);
    expect(path.z[0]).toBe(0);
  });
});

describe('lapExtent', () => {
  it('spans all three axes', () => {
    const { channels } = squareLap({ climb: 100 });
    const e = lapExtent(decodeLapPath(channels, scale));
    expect(e.spanX).toBeCloseTo(200, 0);
    expect(e.spanY).toBeCloseTo(200, 0);
    expect(e.spanZ).toBeCloseTo(100, 0);
  });

  it('returns null for an empty lap', () => {
    expect(lapExtent({ count: 0 })).toBeNull();
    expect(lapExtent(null)).toBeNull();
  });
});

describe('lapProjection', () => {
  const { channels } = squareLap({ climb: 100 });
  const path = decodeLapPath(channels, scale);
  const extent = lapExtent(path);

  it('fits the long horizontal axis to the world size it was given', () => {
    const p = lapProjection(extent, { worldSize: 100 });
    const xs = [];
    for (let i = 0; i < path.count; i++) xs.push(p.project(path.x[i], path.y[i], path.z[i])[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 4);
  });

  it('uses one scale for x and y, so the circuit keeps its shape', () => {
    const p = lapProjection(extent, { worldSize: 100 });
    const a = p.project(0, 0, 0);
    const b = p.project(200, 200, 0);
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(Math.abs(b[2] - a[2]), 5);
  });

  it('applies the exaggeration to z and to nothing else', () => {
    const plain = lapProjection(extent, { worldSize: 100, exaggeration: 1 });
    const tall = lapProjection(extent, { worldSize: 100, exaggeration: 6 });
    const pa = plain.project(200, 200, 100);
    const ta = tall.project(200, 200, 100);
    expect(ta[0]).toBeCloseTo(pa[0], 5);
    expect(ta[2]).toBeCloseTo(pa[2], 5);
    expect(ta[1]).toBeCloseTo(pa[1] * 6, 5);
  });

  it('stands the lap on the datum, so the curtain has a floor to reach', () => {
    const p = lapProjection(extent, { worldSize: 100 });
    let minY = Infinity;
    for (let i = 0; i < path.count; i++) {
      minY = Math.min(minY, p.project(path.x[i], path.y[i], path.z[i])[1]);
    }
    expect(minY).toBeCloseTo(0, 6);
  });

  it('centres the lap horizontally rather than hanging it off one corner', () => {
    const p = lapProjection(extent, { worldSize: 100 });
    const xs = [];
    const zs = [];
    for (let i = 0; i < path.count; i++) {
      const [x, , z] = p.project(path.x[i], path.y[i], path.z[i]);
      xs.push(x);
      zs.push(z);
    }
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 4);
    expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(0, 4);
  });

  it('does not mirror the circuit: north stays north', () => {
    // Data +y is north; scene -z is into the screen. A sign slip here
    // draws every circuit back to front, which is the kind of bug that
    // survives review because it still looks like a racetrack.
    const p = lapProjection(extent, { worldSize: 100 });
    const south = p.project(0, 0, 0)[2];
    const north = p.project(0, 200, 0)[2];
    expect(north).toBeLessThan(south);
  });

  it('reports the relief it drew, for the caption to state', () => {
    const p = lapProjection(extent, { worldSize: 100, exaggeration: 6 });
    // 100 m of climb over a 200 m span, at worldSize 100 and x6.
    expect(p.reliefWorld).toBeCloseTo(300, 4);
  });

  it('keeps relative relief exact between two circuits', () => {
    // The whole reason the exaggeration is one constant: a flat circuit
    // must still be drawn flatter than a hilly one.
    const flat = squareLap({ climb: 10 });
    const hilly = squareLap({ climb: 100 });
    const fp = lapProjection(lapExtent(decodeLapPath(flat.channels, scale)), { worldSize: 100 });
    const hp = lapProjection(lapExtent(decodeLapPath(hilly.channels, scale)), { worldSize: 100 });
    expect(hp.reliefWorld / fp.reliefWorld).toBeCloseTo(10, 4);
  });

  it('returns null with nothing to project', () => {
    expect(lapProjection(null)).toBeNull();
  });
});

describe('buildLapTube', () => {
  const { channels } = squareLap({ climb: 100 });
  const path = decodeLapPath(channels, scale);
  const projection = lapProjection(lapExtent(path), { worldSize: 100 });
  const tube = buildLapTube(path, projection);

  it('emits a four-sided ring per sample and closes the loop', () => {
    expect(tube.positions.length).toBe(path.count * 4 * 3);
    // n quads round a closed loop, 4 faces each, 2 triangles per face.
    expect(tube.indices.length).toBe(path.count * 4 * 6);
  });

  it('indexes only vertices it emitted', () => {
    const vertices = tube.positions.length / 3;
    let max = 0;
    for (const i of tube.indices) max = Math.max(max, i);
    expect(max).toBeLessThan(vertices);
  });

  it('keeps every vertex within a line weight of the centreline', () => {
    // A tube that shears away from its path is the usual symptom of a
    // frame built from a stale tangent.
    const radius = 0.62;
    for (let i = 0; i < path.count; i++) {
      for (let c = 0; c < 4; c++) {
        const o = (i * 4 + c) * 3;
        const d = Math.hypot(
          tube.positions[o] - tube.centreline[i * 3],
          tube.positions[o + 1] - tube.centreline[i * 3 + 1],
          tube.positions[o + 2] - tube.centreline[i * 3 + 2],
        );
        expect(d).toBeCloseTo(radius, 4);
      }
    }
  });

  it('gives every vertex a unit normal', () => {
    for (let v = 0; v < tube.normals.length / 3; v++) {
      const len = Math.hypot(tube.normals[v * 3], tube.normals[v * 3 + 1], tube.normals[v * 3 + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('carries the speed band on every vertex of a ring', () => {
    const band = speedBand(path.speed[0]);
    for (let c = 0; c < 4; c++) expect(tube.bands[c]).toBe(band);
  });

  it('bands actually vary along a lap that changes speed', () => {
    expect(new Set(Array.from(tube.bands)).size).toBeGreaterThan(1);
  });

  it('returns null with nothing to build', () => {
    expect(buildLapTube({ count: 0 }, projection)).toBeNull();
    expect(buildLapTube(path, null)).toBeNull();
  });
});

describe('buildLapCurtain', () => {
  const { channels } = squareLap({ climb: 100 });
  const path = decodeLapPath(channels, scale);
  const projection = lapProjection(lapExtent(path), { worldSize: 100 });
  const curtain = buildLapCurtain(path, projection);

  it('hangs a vertex pair from every sample', () => {
    expect(curtain.positions.length).toBe(path.count * 2 * 3);
    expect(curtain.indices.length).toBe(path.count * 6);
  });

  it('drops each bottom vertex straight down from its top one', () => {
    for (let i = 0; i < path.count; i++) {
      expect(curtain.positions[i * 6 + 3]).toBeCloseTo(curtain.positions[i * 6], 5);
      expect(curtain.positions[i * 6 + 5]).toBeCloseTo(curtain.positions[i * 6 + 2], 5);
      expect(curtain.positions[i * 6 + 4]).toBe(0);
    }
  });

  it('normalises height over the lap it drew, reaching 1 at the high point', () => {
    let max = 0;
    for (const h of curtain.heights) max = Math.max(max, h);
    expect(max).toBeCloseTo(1, 5);
  });

  it('has no height at all where a lap is flat, rather than dividing by zero', () => {
    const flat = squareLap({ climb: 0 });
    const fp = decodeLapPath(flat.channels, scale);
    const c = buildLapCurtain(fp, lapProjection(lapExtent(fp), { worldSize: 100 }));
    for (const h of c.heights) expect(Number.isFinite(h)).toBe(true);
  });

  it('returns null with nothing to build', () => {
    expect(buildLapCurtain({ count: 0 }, projection)).toBeNull();
  });
});

describe('fitDistance', () => {
  const { channels } = squareLap({ climb: 100 });
  const path = decodeLapPath(channels, scale);
  const extent = lapExtent(path);
  const projection = lapProjection(extent, { worldSize: 100 });
  const tube = buildLapTube(path, projection);
  const target = [0, projection.reliefWorld / 2, 0];
  const view = { yaw: 0.4, pitch: 0.42, fovDeg: 42, aspect: 2.8 };

  /** Is every drawn point inside the frustum at this distance? */
  function allVisible(distance, { yaw, pitch, fovDeg, aspect }) {
    const tanV = Math.tan((fovDeg * Math.PI) / 180 / 2);
    const tanH = tanV * aspect;
    const fx = Math.cos(pitch) * Math.sin(yaw);
    const fy = Math.sin(pitch);
    const fz = Math.cos(pitch) * Math.cos(yaw);
    const rl = Math.hypot(fz, 0, -fx);
    const rx = fz / rl;
    const rz = -fx / rl;
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    for (let i = 0; i < tube.count; i++) {
      const px = tube.centreline[i * 3] - target[0];
      const py = tube.centreline[i * 3 + 1] - target[1];
      const pz = tube.centreline[i * 3 + 2] - target[2];
      const depth = distance - (px * fx + py * fy + pz * fz);
      if (depth <= 0) return false;
      if (Math.abs(px * rx + pz * rz) > tanH * depth + 1e-9) return false;
      if (Math.abs(px * ux + py * uy + pz * uz) > tanV * depth + 1e-9) return false;
    }
    return true;
  }

  it('holds the whole lap in frame', () => {
    expect(allVisible(fitDistance(tube.centreline, tube.count, target, view), view)).toBe(true);
  });

  it('holds it at every camera angle it can be dragged to', () => {
    for (const yaw of [0, 1, 2.2, 4, 6]) {
      for (const pitch of [0.12, 0.6, 1.35]) {
        const v = { ...view, yaw, pitch };
        const d = fitDistance(tube.centreline, tube.count, target, v);
        expect(allVisible(d, v), `yaw ${yaw} pitch ${pitch}`).toBe(true);
      }
    }
  });

  it('does not waste the frame: pulling in a little clips the lap', () => {
    // This is the regression the sphere fit failed. It framed correctly
    // and left two thirds of the picture empty, which no assertion about
    // "everything is visible" would ever have caught.
    const d = fitDistance(tube.centreline, tube.count, target, { ...view, fill: 1 });
    expect(allVisible(d, view)).toBe(true);
    expect(allVisible(d * 0.9, view)).toBe(false);
  });

  it('uses the width of a wide frame rather than fitting to its short axis', () => {
    // On a wide, flat lap — which is what a circuit is — the horizontal
    // constraint is the binding one, so a wider frame must let the
    // camera come in. This is the sphere fit's actual failure: it fitted
    // the loop's WIDTH to the frame's SHORT axis and left two thirds of
    // a 2.8:1 picture empty.
    //
    // The fixture has to be wide and flat for the assertion to mean
    // anything: on a lap with 300 units of relief over 100 of width the
    // vertical constraint binds at every aspect, and the distance is
    // correctly identical.
    const flat = wideLap();
    const fpath = decodeLapPath(flat.channels, scale);
    const fproj = lapProjection(lapExtent(fpath), { worldSize: 100 });
    const ftube = buildLapTube(fpath, fproj);
    const ftarget = [0, fproj.reliefWorld / 2, 0];
    const wide = fitDistance(ftube.centreline, ftube.count, ftarget, { ...view, aspect: 4 });
    const square = fitDistance(ftube.centreline, ftube.count, ftarget, { ...view, aspect: 1 });
    expect(wide).toBeLessThan(square);
  });

  it('leaves the margin fill asks for', () => {
    const tight = fitDistance(tube.centreline, tube.count, target, { ...view, fill: 1 });
    const airy = fitDistance(tube.centreline, tube.count, target, { ...view, fill: 0.8 });
    expect(airy).toBeGreaterThan(tight);
    expect(airy).toBeCloseTo(tight / 0.8, 6);
  });

  it('backs off further for a hillier circuit, since the relief has to fit too', () => {
    const flat = squareLap({ climb: 2 });
    const fpath = decodeLapPath(flat.channels, scale);
    const fproj = lapProjection(lapExtent(fpath), { worldSize: 100 });
    const ftube = buildLapTube(fpath, fproj);
    const flatD = fitDistance(ftube.centreline, ftube.count, [0, fproj.reliefWorld / 2, 0], view);
    const hillyD = fitDistance(tube.centreline, tube.count, target, view);
    expect(hillyD).toBeGreaterThan(flatD);
  });

  it('returns null with nothing to frame', () => {
    expect(fitDistance(tube.centreline, 0, target, view)).toBeNull();
  });
});

describe('openingYaw', () => {
  it('turns an east-west circuit to face the camera down its short axis', () => {
    // Longest in scene x: the camera's right vector is already along x
    // at yaw 0, so only the skew is wanted.
    const wide = lapExtent(decodeLapPath(wideLap().channels, scale));
    expect(openingYaw(wide)).toBeCloseTo(OPENING_SKEW, 6);
  });

  it('turns a north-south circuit a quarter turn, so its length is across the frame', () => {
    // Spa's shape: longest in the data's y, which the projection maps
    // onto scene z. Left at yaw 0 its length runs into the screen and
    // costs depth instead of using the frame's width.
    const tallPlan = { spanX: 1265, spanY: 2032, spanZ: 102 };
    expect(openingYaw(tallPlan)).toBeCloseTo(Math.PI / 2 + OPENING_SKEW, 6);
  });

  it('never opens square-on, which would render the lap as an elevation drawing', () => {
    for (const extent of [{ spanX: 10, spanY: 1 }, { spanX: 1, spanY: 10 }]) {
      const yaw = openingYaw(extent);
      // Not aligned with either axis of the circuit.
      expect(Math.abs(Math.sin(yaw))).toBeGreaterThan(0.05);
      expect(Math.abs(Math.cos(yaw))).toBeGreaterThan(0.05);
    }
  });

  it('puts more of the lap across the frame than the fixed angle did', () => {
    // The regression, stated as the thing a reader actually sees: at the
    // old fixed 29 degrees Spa's long axis pointed into the screen.
    const spa = { spanX: 1265, spanY: 2032, spanZ: 102 };
    const across = (yaw) => {
      // Extent of the plan, projected onto the camera's right vector.
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      return Math.abs(spa.spanX * rx) + Math.abs(spa.spanY * rz);
    };
    expect(across(openingYaw(spa))).toBeGreaterThan(across(Math.PI * 0.16));
  });

  it('has an answer for a lap with no extent', () => {
    expect(openingYaw(null)).toBe(0);
  });
});

describe('the constants are the ones the caption promises', () => {
  it('exaggerates six times', () => {
    // Changing this changes what every caption on the site claims.
    expect(VERTICAL_EXAGGERATION).toBe(6);
  });

  it('bands speed on the same edges as the Racing Lines channel map', () => {
    expect(SPEED_BAND_EDGES).toEqual([100, 175, 235, 290]);
  });
});
