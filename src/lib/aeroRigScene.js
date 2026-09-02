import * as THREE from 'three';
import { needsResize } from './canvasSize.js';

// The car is lofted, not stacked.
//
// An F1 car is a continuously changing cross-section: a point at the nose
// tip, wide and tall at the cockpit, pinched into the coke-bottle waist,
// tapering to the crash structure. So the bodywork is built by lofting a
// skin over cross-sections defined every few centimetres, and every wing
// is a real aerofoil profile extruded along its span, rather than a stack
// of boxes with the right footprint. It is a diagram drawn to the
// published 2026 dimensions — narrower front wing, three-element rear
// wing, no beam wing, 18-inch wheels — not a scan of anyone's car, and it
// carries no team livery, badge or colour scheme.
//
// createAeroRig(canvas, { onPick }) builds the scene, starts its own
// render loop, and returns { setMode(mode), dispose() }. It knows nothing
// about what a part is called or what to say about it — see
// aeroRigParts.js for that — it only ever hands back the raw part key a
// click landed on, through onPick.
export function createAeroRig(canvas, { onPick = () => {} } = {}) {
  let currentMode = 'Z';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0c10, 11, 28);

  const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 200);
  const home = new THREE.Vector3(5.2, 2.4, 5.9);
  camera.position.copy(home);

  const target = new THREE.Vector3(0, 0.44, 0);
  const camGoal = home.clone();
  const targetGoal = target.clone();

  scene.add(new THREE.AmbientLight(0x7d8db0, 0.42));
  const key = new THREE.DirectionalLight(0xffffff, 1.45);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 1.35);
  rim.position.set(-6, 2.2, -6);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xdfe8ff, 0.9);
  rim2.position.set(7, 1.4, -4);
  scene.add(rim2);
  const warm = new THREE.DirectionalLight(0xff6a45, 0.55);
  warm.position.set(-4, 1.2, 6);
  scene.add(warm);
  const under = new THREE.DirectionalLight(0x6f86b5, 0.16);
  under.position.set(0, -4, 1);
  scene.add(under);

  // A ground plane and a contact shadow. Without them the car floats, and
  // a floating object never reads as a real one however well it is shaped.
  const fade = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0.62)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.34)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 46),
    new THREE.MeshStandardMaterial({
      color: 0x080a0f, roughness: 1, metalness: 0,
      transparent: true, opacity: 0.55, alphaMap: fade, depthWrite: false,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  scene.add(ground);

  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.92)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.44)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 3.0),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0.1, 0.004, 0);
  scene.add(contact);
  /* ---------------- geometry ---------------- */

  const body = new THREE.MeshStandardMaterial({ color: 0xe0261c, roughness: 0.28, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.7, metalness: 0.3 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x333a48, roughness: 0.52, metalness: 0.55 });
  const underbody = new THREE.MeshStandardMaterial({
    color: 0x0e1015, roughness: 0.94, metalness: 0.04, flatShading: true,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.95, metalness: 0.04 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xb9c2d0, roughness: 0.25, metalness: 0.9 });
  // The halo is a carbon-skinned structure and reads near-black on every
  // real car, not as bare titanium — but glossy enough to catch a rim
  // light along its top edge, which is what stops it looking like a line
  // drawn over the cockpit.
  const haloMat = new THREE.MeshStandardMaterial({
    color: 0x15181f, roughness: 0.32, metalness: 0.52,
  });
  // The camera pod's identification colour. Mandatory equipment in a
  // mandated colour, not a livery choice.
  const marker = new THREE.MeshStandardMaterial({
    color: 0xd6dc1e, emissive: 0x3a4000, roughness: 0.44,
  });
  // Cockpit interior. Fireproof overalls are matt cloth, a helmet is
  // glossy painted composite, a visor is darker and glossier still —
  // three different surfaces, and lighting them all as bare metal is
  // what made the driver read as a chrome ornament.
  const suit = new THREE.MeshStandardMaterial({
    color: 0x272d38, roughness: 0.88, metalness: 0.04,
  });
  const helmetShell = new THREE.MeshStandardMaterial({
    color: 0xdde3ec, roughness: 0.20, metalness: 0.08,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12, roughness: 0.10, metalness: 0.30, side: THREE.DoubleSide,
  });

  const car = new THREE.Group();
  scene.add(car);

  // The car is lofted, not stacked.
  //
  // The first build assembled it from boxes and it read as a stack of
  // boxes, because that is what it was. An F1 car is a continuously
  // changing cross-section: a point at the nose tip, wide and tall at the
  // cockpit, pinched into the coke-bottle waist, tapering to the crash
  // structure. Nothing made of cuboids has any of that.
  //
  // So the bodywork is built by lofting a skin over cross-sections defined
  // every few centimetres, and every wing is a real aerofoil profile
  // extruded along its span. It is still a diagram drawn to the published
  // 2026 dimensions rather than a scan of anyone's car — it is just a
  // diagram that has the right shape now.

  /** A superelliptical cross-section: round at the nose, squarer at the tub. */
  function ring(halfWidth, halfHeight, centreY, squareness = 2.4, segments = 26) {
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

  /** A rounded-trapezoid outline: wide across the top, narrow at the
   *  bottom. Air intakes are this shape, not the oval a plain
   *  superellipse gives — photographs looking straight into an airbox
   *  show a broad roof narrowing to a slot at the floor, and that taper
   *  is most of what makes an opening read as a duct going somewhere. */
  function mouthRing(topHalfWidth, bottomHalfWidth, halfHeight, centreY,
    squareness = 2.6, segments = 30) {
    const pts = [];
    for (let i = 0; i < segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const p = 2 / squareness;
      const sy = Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** p;
      const sx = Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** p;
      const up = (sy + 1) / 2;
      const w = bottomHalfWidth + (topHalfWidth - bottomHalfWidth) * up;
      pts.push([centreY + halfHeight * sy, w * sx]);
    }
    return pts;
  }

  /** A cross-section with the cockpit trough pressed into its top.
   *
   *  The survival cell is one closed loft, so there was no hole for a
   *  driver to sit in: the opening was a dark patch painted on an
   *  unbroken surface, and anything placed "inside" was sealed in the
   *  solid. Pushing the top of the section down between the two rim
   *  edges makes a real trough — the loft stays closed and watertight,
   *  and what is in the trough is genuinely visible.
   *
   *  The rim rolls into the floor over a smoothstep rather than a step,
   *  or the opening reads as a slot cut with a knife. */
  function cockpitRing(w, h, cy, q, mouth, floorY, segments) {
    return ring(w, h, cy, q, segments).map(([y, z]) => {
      if (y <= floorY) return [y, z];
      const t = Math.min(1, Math.abs(z) / mouth);
      const blend = t * t * (3 - 2 * t);
      return [floorY + (y - floorY) * blend, z];
    });
  }

  /** Skin a set of cross-sections into one closed surface. */
  function loft(stations, material, part, { capFront = true, capBack = true } = {}) {
    const seg = stations[0].ring.length;
    const pos = [];
    const index = [];
    for (const st of stations) for (const [y, z] of st.ring) pos.push(st.x, y, z);

    for (let s = 0; s < stations.length - 1; s += 1) {
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        const a = s * seg + i;
        const b = s * seg + j;
        const c = (s + 1) * seg + i;
        const d = (s + 1) * seg + j;
        index.push(a, c, b, b, c, d);
      }
    }
    // Fan caps, so the ends are solid rather than open tubes.
    const cap = (stationIndex, flip) => {
      const base = pos.length / 3;
      const st = stations[stationIndex];
      let cy = 0;
      let cz = 0;
      for (const [y, z] of st.ring) { cy += y; cz += z; }
      pos.push(st.x, cy / seg, cz / seg);
      for (let i = 0; i < seg; i += 1) {
        const a = stationIndex * seg + i;
        const b = stationIndex * seg + ((i + 1) % seg);
        index.push(flip ? a : b, flip ? b : a, base);
      }
    };
    if (capFront) cap(0, true);
    if (capBack) cap(stations.length - 1, false);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.part = part;
    car.add(mesh);
    return mesh;
  }

  /** A cambered aerofoil section, leading edge at the origin. */
  /** One closed aerofoil outline, as [chordwise, vertical] points.
   *
   *  The old section was two bezier curves meeting at a POINT at the
   *  leading edge. A sharp leading edge is the single thing that makes a
   *  wing read as a plank: real ones are blunt and round at the front and
   *  sharp only at the back, and the eye knows the difference even at
   *  thumbnail size. This is the NACA four-digit thickness distribution,
   *  which is round at the nose by construction, laid over a cambered
   *  mean line that finishes `drop` low so the element is an inverted
   *  wing rather than a symmetric strut.
   *
   *  Points are cosine-spaced, so they bunch where the curvature is —
   *  at the leading edge — instead of being wasted along the flat middle. */
  function aerofoilPoints(chord, thickness, drop, n = 20) {
    const upper = [];
    const lower = [];
    for (let i = 0; i <= n; i += 1) {
      const xc = 0.5 - 0.5 * Math.cos(Math.PI * (i / n));
      // The bracket peaks at 0.1015, so this scale keeps `thickness`
      // meaning what it did before: maximum half-thickness in metres.
      const yt = 9.85 * thickness * (0.2969 * Math.sqrt(xc) - 0.1260 * xc
        - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
      const camber = -drop * xc * xc;
      upper.push([xc * chord, camber + yt]);
      lower.push([xc * chord, camber - yt]);
    }
    // Drop the shared nose and tail points so the loop closes cleanly.
    return upper.concat(lower.reverse().slice(1, -1));
  }

  /** A wing element, lofted across its span rather than extruded.
   *
   *  Extruding held one section along the whole span, which is what made
   *  these read as planks with wing-shaped ends: a real element loses
   *  chord and thickness toward the tip, sweeps back, and arches up into
   *  the endplate. Lofting a section per station gives all three, and
   *  costs a few hundred vertices.
   *
   *  taper — tip chord as a fraction of root chord
   *  sweep — how far the tip's leading edge sits behind the root's
   *  curve — how far the tip rises above the root
   *  dip   — how far the middle of the span falls below both
   *
   *  `dip` is what makes a front wing a front wing. Seen head-on the real
   *  thing is a gullwing: highest at the centre where it meets the nose,
   *  falling away through mid-span, rising again into the endplate. A
   *  single parabola from centre to tip cannot make that shape — it can
   *  only arch one way — and an element that arches one way is a bar with
   *  a bend in it, which is exactly how this used to read. */
  function wingElement(opts) {
    const {
      chord, thickness, span, drop = 0, x, y, z = 0, tilt = 0, mat, part,
      curve = 0, taper = 1, sweep = 0, dip = 0, steps = 22,
    } = opts;
    const half = span / 2;
    const stations = [];
    for (let s = 0; s <= steps; s += 1) {
      const zz = -half + (s / steps) * span;
      const u = Math.abs(zz) / half;
      const pts = aerofoilPoints(
        chord * (1 - (1 - taper) * u * u),
        thickness * (1 - 0.40 * u * u),
        drop,
      );
      const dx = sweep * u * u;
      // Cubic rise to the tip, minus a half-sine that is zero at both
      // ends and deepest in the middle: centre high, mid-span low, tip
      // high again.
      const dy = curve * u ** 3 - dip * Math.sin(Math.PI * u);
      stations.push({ zz, pts: pts.map(([px, py]) => [px + dx, py + dy]) });
    }

    const seg = stations[0].pts.length;
    const position = [];
    for (const st of stations) for (const [px, py] of st.pts) position.push(px, py, st.zz);
    const index = [];
    for (let s = 0; s < stations.length - 1; s += 1) {
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        index.push(
          s * seg + i, (s + 1) * seg + i, s * seg + j,
          s * seg + j, (s + 1) * seg + i, (s + 1) * seg + j,
        );
      }
    }
    // Close both tips, or the wing is a tube open at each end.
    const last = (stations.length - 1) * seg;
    for (let i = 1; i < seg - 1; i += 1) {
      index.push(0, i + 1, i);
      index.push(last, last + i, last + i + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = tilt;
    mesh.position.set(x, y, z);
    mesh.userData.part = part;
    return mesh;
  }

  /** A vertical plate: outline in the fore-aft plane, thin across the car.
      Endplates, floor fences and diffuser strakes are all this shape. */
  function plate(points, thickness, mat, part, x, y, z) {
    const shape = new THREE.Shape();
    points.forEach(([a, b], i) => (i ? shape.lineTo(a, b) : shape.moveTo(a, b)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geo.translate(0, 0, -thickness / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData.part = part;
    car.add(mesh);
    return mesh;
  }

  /** A straight member running from one point to another.
   *
   *  Suspension arms are aimed, not axis-aligned, and hand-rotating a
   *  cylinder to each one's angle is how the old build ended up with
   *  arms that missed the upright. Giving the geometry its length along
   *  local +Z and then pointing that at the far end puts both ends
   *  exactly where they belong, whatever the angle. */
  function strut(from, to, chord, thick, mat, part) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(chord, thick, dir.length()), mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.lookAt(to);
    mesh.userData.part = part;
    car.add(mesh);
    return mesh;
  }

  /** Sweep an upright oval section along a 3D curve.
   *
   *  Three's own TubeGeometry frames each section with a Frenet normal,
   *  which rolls over where a curve's curvature reverses — on a loop like
   *  the halo that puts a visible twist half way along a rail. Building
   *  the frame from world up instead cannot twist: the section stays
   *  vertical the whole way round, which is what the real part does. The
   *  section is narrow across and deep vertically, so the halo comes out
   *  as the blade it is rather than as a round rod. */
  function sweep(curve, halfWide, halfTall, mat, part, steps = 108, sides = 12) {
    const pos = [];
    const index = [];
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3();
    const upright = new THREE.Vector3();
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      across.crossVectors(tan, up).normalize();
      upright.crossVectors(across, tan).normalize();
      for (let i = 0; i < sides; i += 1) {
        const a = (i / sides) * Math.PI * 2;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        pos.push(
          p.x + across.x * halfWide * c + upright.x * halfTall * sn,
          p.y + across.y * halfWide * c + upright.y * halfTall * sn,
          p.z + across.z * halfWide * c + upright.z * halfTall * sn,
        );
      }
    }
    for (let s = 0; s < steps; s += 1) {
      for (let i = 0; i < sides; i += 1) {
        const j = (i + 1) % sides;
        index.push(
          s * sides + i, (s + 1) * sides + i, s * sides + j,
          s * sides + j, (s + 1) * sides + i, (s + 1) * sides + j,
        );
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.part = part;
    car.add(mesh);
    return mesh;
  }

  /* ---------------- dimensions ----------------
     Metres, from the published 2026 figures: 1.9 m over the wheels, under
     0.95 m at the rear wing, 18-inch wheels at 0.72 m diameter, a front
     wing narrower than the car. */
  const R_TYRE = 0.36;
  const W_HALF = 0.735;
  const AXLE = R_TYRE;
  const X_FRONT = -1.62;
  const X_REAR = 1.72;

  /* ---------------- monocoque ----------------
     Every station is a cross-section: a point at the tip, widening through
     the chassis, at its fullest around the cockpit, then pinched hard into
     the coke-bottle waist ahead of the rear axle. */
  // The nose and the chassis are two volumes, not one. A single loft from
  // tip to tail gave a continuous cigar, and the thing that actually reads
  // on a real car is the step at the front bulkhead where the slim nose
  // meets the full-width survival cell. They overlap so the step is a
  // shoulder rather than a seam.
  const NOSE = [
    { x: -2.60, w: 0.050, h: 0.044, cy: 0.290, q: 2.6 },
    { x: -2.48, w: 0.064, h: 0.054, cy: 0.296, q: 2.5 },
    { x: -2.24, w: 0.082, h: 0.068, cy: 0.310, q: 2.4 },
    { x: -1.92, w: 0.100, h: 0.084, cy: 0.334, q: 2.4 },
    { x: -1.56, w: 0.118, h: 0.100, cy: 0.358, q: 2.5 },
    { x: -1.26, w: 0.134, h: 0.114, cy: 0.376, q: 2.6 },
    { x: -1.06, w: 0.146, h: 0.124, cy: 0.386, q: 2.7 },
  ];
  loft(NOSE.map((s) => ({ x: s.x, ring: ring(s.w, s.h, s.cy, s.q) })), body, 'nose');

  // Stations carrying `mouth` and `floor` have the cockpit trough pressed
  // into them. It opens narrow ahead of the driver, is deepest and widest
  // at the seat, and closes again before the headrest.
  const TUB_SEG = 44;
  const TUB = [
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
    { x: 1.72, w: 0.108, h: 0.128, cy: 0.378, q: 2.4 },
    { x: 1.98, w: 0.076, h: 0.100, cy: 0.362, q: 2.3 },
    { x: 2.20, w: 0.056, h: 0.076, cy: 0.350, q: 2.2 },
  ];
  loft(TUB.map((s) => ({
    x: s.x,
    ring: s.mouth
      ? cockpitRing(s.w, s.h, s.cy, s.q, s.mouth, s.floor, TUB_SEG)
      : ring(s.w, s.h, s.cy, s.q, TUB_SEG),
  })), body, 'floor');

  /* ---------------- engine cover and airbox ----------------
     A separate volume sitting on the tub: the intake mouth behind the
     driver's head, tapering into the spine that feeds the rear wing. */
  // The roll hoop stands BEHIND the driver's head, not over it — checked
  // against side-on and overhead photographs of the real car, where the
  // helmet sits clear in front of the intake and the hoop rises behind
  // the headrest. An earlier build had the apex at the same station as
  // the helmet, which put the intake in front of the driver's face.
  // The roll hoop's front is BLUNT — a near-vertical face with the
  // intake cut into it — not a cone tapering to a point. That matters
  // for more than silhouette: the cover is a closed loft, so a duct
  // modelled inside a pointed nose is sealed in the solid and cannot be
  // seen at all. It only ever showed because it was oversized and burst
  // out through the flanks. A blunt face gives the opening somewhere to
  // actually be.
  // The hoop arches ABOVE the helmet, not merely behind it. It topped
  // out three centimetres over the top of the driver's head, which put
  // the intake at head height looking like a bulge behind him; a roll
  // structure has to stand clear over the helmet, and the intake with
  // it. Apex is now ~0.90 against a helmet crown at 0.775.
  // The front face is the intake, and almost nothing else.
  //
  // It used to be 28 cm tall against a 13 cm mouth sitting in the top
  // half of it, which left thirteen centimetres of flat red wall below
  // the opening. Rendered from the side that is not an airbox: it is a
  // red box strapped behind the driver with a slot in it. On a real car
  // the structure necks down hard below the mouth into the headrest —
  // there is no wall there to see. The first station is now 18 cm tall
  // and the mouth fills all but a couple of centimetres of rim, so the
  // hoop reads as a duct standing up out of the bodywork. The volume it
  // loses is put back further aft, where the cover actually is bulky.
  const COVER = [
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
  loft(COVER.map((s) => ({ x: s.x, ring: ring(s.w, s.h, s.cy, s.q) })), body, 'airbox');
  // The airbox intake.
  //
  // Photographs taken straight into a real one show a broad roof
  // narrowing to a slot at the floor — a rounded triangle, not the oval
  // that was here — and a deep throat you can see a long way down, with
  // a carbon lip standing proud all round the mouth. The taper is what
  // says the duct goes somewhere; the oval said "dimple".
  // The throat now stands a full 3 cm proud of that face and sits above
  // the helmet crown, in the blackest material on the car. A few
  // millimetres of dark rim flush against red bodywork was technically
  // an opening and read as a smudge — an air intake has to look like a
  // hole you could put your arm down.
  loft([
    { x: 0.045, ring: mouthRing(0.070, 0.030, 0.070, 0.812, 2.4) },
    { x: 0.150, ring: mouthRing(0.062, 0.026, 0.060, 0.802, 2.4) },
    { x: 0.300, ring: mouthRing(0.046, 0.018, 0.042, 0.780, 2.4) },
    { x: 0.460, ring: mouthRing(0.024, 0.010, 0.025, 0.740, 2.4) },
    { x: 0.600, ring: mouthRing(0.013, 0.005, 0.014, 0.700, 2.4) },
  ], underbody, 'airbox', { capFront: false });
  // The lip around the mouth, which is what catches the light and makes
  // the opening read from a distance.
  loft([
    { x: 0.026, ring: mouthRing(0.084, 0.044, 0.084, 0.812, 2.4) },
    { x: 0.062, ring: mouthRing(0.079, 0.041, 0.079, 0.812, 2.4) },
  ], body, 'airbox', { capFront: false, capBack: false });
  // Side cooling inlets in the flanks of the hoop — more real holes,
  // and the reason the structure is as wide as it is.
  for (const side of [1, -1]) {
    loft([
      { x: 0.150, ring: ring(0.010, 0.030, 0.772, 3).map(([y, z]) => [y, z + side * 0.090]) },
      { x: 0.300, ring: ring(0.008, 0.024, 0.756, 3).map(([y, z]) => [y, z + side * 0.114]) },
    ], underbody, 'airbox', { capFront: false });
  }
  // A second, smaller duct along the floor of the throat. Every close-up
  // of the real intake shows one down there, feeding something other
  // than the engine — which of the car's several cooling circuits is not
  // published, so it is drawn and not labelled.
  loft([
    { x: 0.056, ring: ring(0.026, 0.008, 0.756, 4) },
    { x: 0.280, ring: ring(0.015, 0.005, 0.744, 4) },
  ], dark, 'airbox', { capFront: false });

  /* ---------------- sidepods ----------------
     Wide at the inlet, undercut hard along the bottom edge, and drawn in
     to nothing at the rear — the shape that makes the waist. */
  for (const side of [1, -1]) {
    const POD = [
      { x: -0.62, w: 0.030, h: 0.092, cy: 0.300, z: 0.505 },
      { x: -0.46, w: 0.112, h: 0.134, cy: 0.302, z: 0.516 },
      { x: -0.14, w: 0.152, h: 0.150, cy: 0.308, z: 0.528 },
      { x: 0.24, w: 0.154, h: 0.144, cy: 0.314, z: 0.520 },
      { x: 0.62, w: 0.132, h: 0.128, cy: 0.324, z: 0.480 },
      { x: 1.00, w: 0.096, h: 0.104, cy: 0.338, z: 0.400 },
      { x: 1.34, w: 0.056, h: 0.076, cy: 0.354, z: 0.302 },
      { x: 1.60, w: 0.026, h: 0.046, cy: 0.368, z: 0.224 },
    ];
    loft(POD.map((s) => ({
      x: s.x,
      ring: ring(s.w, s.h, s.cy, 2.9).map(([y, z]) => [y, z + side * s.z]),
    })), body, 'sidepod');
    // The undercut, in shadow: the step between pod and floor is most of
    // what makes a sidepod read as a sidepod rather than as a bulge.
    loft([
      { x: -0.40, ring: ring(0.030, 0.052, 0.214, 3.2).map(([y, z]) => [y, z + side * 0.470]) },
      { x: 0.20, ring: ring(0.036, 0.056, 0.220, 3.2).map(([y, z]) => [y, z + side * 0.462]) },
      { x: 0.90, ring: ring(0.030, 0.048, 0.238, 3.2).map(([y, z]) => [y, z + side * 0.390]) },
      { x: 1.40, ring: ring(0.020, 0.034, 0.268, 3.2).map(([y, z]) => [y, z + side * 0.288]) },
    ], dark, 'sidepod');
  }

  /* ---------------- details that the eye looks for ----------------
     Not decoration: a car without a cockpit opening, a radiator exit or a
     gearbox reads as a shape rather than as a machine. */

  // Head protection padding, wrapping behind and up the sides of the
  // opening. Raised to stand proud of the cell rather than sit inside
  // it: on the real car this is a distinctly raised horseshoe, and it is
  // mandated equipment whose shape the 2026 rules did not change.
  // Sits a little lower than the airbox throat above and behind it, so
  // the two meet rather than pass through each other.
  loft([
    { x: 0.14, ring: ring(0.150, 0.046, 0.612, 3.0) },
    { x: 0.24, ring: ring(0.156, 0.052, 0.616, 3.0) },
    { x: 0.34, ring: ring(0.134, 0.042, 0.608, 3.0) },
  ], dark, 'halo');

  // Sidepod inlet.
  //
  // There were two of these lofted almost on top of each other, a few
  // millimetres and one station apart — two near-coplanar dark surfaces
  // fighting for the same pixels, and neither carried the lip the
  // comment claimed. This is one duct, tapering back into the pod, with
  // a raised surround, and it uses the same broad-roof-narrow-floor
  // shape as the airbox because it is the same kind of opening.
  for (const side of [1, -1]) {
    loft([
      { x: -0.590, ring: mouthRing(0.058, 0.030, 0.088, 0.303, 2.5).map(([y, z]) => [y, z + side * 0.512]) },
      { x: -0.500, ring: mouthRing(0.050, 0.026, 0.076, 0.305, 2.5).map(([y, z]) => [y, z + side * 0.510]) },
      { x: -0.390, ring: mouthRing(0.038, 0.020, 0.058, 0.308, 2.5).map(([y, z]) => [y, z + side * 0.507]) },
      { x: -0.290, ring: mouthRing(0.026, 0.014, 0.040, 0.311, 2.5).map(([y, z]) => [y, z + side * 0.503]) },
    ], dark, 'sidepod', { capFront: false });
    loft([
      { x: -0.612, ring: mouthRing(0.070, 0.040, 0.100, 0.303, 2.5).map(([y, z]) => [y, z + side * 0.512]) },
      { x: -0.582, ring: mouthRing(0.066, 0.037, 0.096, 0.303, 2.5).map(([y, z]) => [y, z + side * 0.512]) },
    ], body, 'sidepod', { capFront: false, capBack: false });
    // Cooling exit louvres: a bank along the pod shoulder and a second up
    // on the engine cover flank. Every car has to dump its radiator heat
    // somewhere along here, and the vents are the most visible thing on
    // the upper bodywork — this was one flat painted-looking stripe.
    //
    // Drawn as a plain row of slots on purpose. The arrangement teams
    // actually run is a cooling decision, traded against drag, and
    // neither side of that trade is published anywhere this project can
    // reach — so copying any particular one would be inventing detail.
    for (let i = 0; i < 6; i += 1) {
      const t = i / 5;
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.010, 0.064), dark);
      slot.position.set(0.20 + t * 0.62, 0.450 - t * 0.012, side * (0.512 - t * 0.078));
      slot.rotation.x = side * 0.20;
      slot.rotation.y = side * 0.10;
      slot.userData.part = 'sidepod';
      car.add(slot);
    }
    for (let i = 0; i < 7; i += 1) {
      const t = i / 6;
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.009, 0.034), dark);
      slot.position.set(0.58 + t * 0.54, 0.772 - t * 0.126, side * (0.124 - t * 0.024));
      slot.rotation.x = side * 0.80;
      slot.rotation.z = -0.10;
      slot.userData.part = 'airbox';
      car.add(slot);
    }
    // In-wash wake-control board ahead of the inlet, angled to turn the
    // front tyre's wake inward — 2026's published shift from the previous
    // cars' outwash aim.
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.10, 0.012), carbon);
    board.position.set(-0.86, 0.31, side * 0.470);
    board.rotation.y = side * -0.32;
    board.userData.part = 'sidepod';
    car.add(board);
  }

  // Rear crash structure and gearbox fairing, so the tail is a car and not
  // a taper running into thin air.
  loft([
    { x: 1.62, ring: ring(0.112, 0.104, 0.300, 2.8) },
    { x: 1.92, ring: ring(0.092, 0.086, 0.286, 2.8) },
    { x: 2.16, ring: ring(0.066, 0.062, 0.276, 2.6) },
    { x: 2.34, ring: ring(0.046, 0.042, 0.270, 2.4) },
  ], carbon, 'diffuser');
  // Rain light, low and central on the crash structure.
  // The rain light: a dark panel standing on the crash structure with a
  // ring of LEDs on its back face, which is what photographs from behind
  // actually show — not the solid red block this used to be. Mandatory
  // equipment, the same on every car.
  const lightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.132, 0.104), haloMat);
  lightPanel.position.set(2.352, 0.300, 0);
  lightPanel.userData.part = 'diffuser';
  car.add(lightPanel);
  const lamp = new THREE.Mesh(
    new THREE.TorusGeometry(0.034, 0.009, 8, 22),
    new THREE.MeshStandardMaterial({ color: 0xff2a1e, emissive: 0x8c1409, roughness: 0.45 }),
  );
  lamp.rotation.y = Math.PI / 2;
  lamp.position.set(2.370, 0.300, 0);
  lamp.userData.part = 'diffuser';
  car.add(lamp);

  /* ---------------- floor, edge fences and diffuser ---------------- */
  const FLOOR = [
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
  loft(FLOOR.map((s) => ({ x: s.x, ring: ring(s.w, s.h, s.cy, 6) })), underbody, 'floor');

  // The diffuser: the floor's exit, ramped up and fenced.
  loft([
    { x: 1.70, ring: ring(0.520, 0.022, 0.092, 5) },
    { x: 1.96, ring: ring(0.512, 0.044, 0.132, 5) },
    { x: 2.18, ring: ring(0.498, 0.070, 0.180, 5) },
    { x: 2.34, ring: ring(0.480, 0.086, 0.212, 5) },
  ], underbody, 'diffuser');
  for (const side of [1, -1]) {
    for (const z of [0.30, 0.45]) {
      plate([[0, 0], [0.62, 0], [0.62, 0.17], [0, 0.10]], 0.016, underbody, 'diffuser',
        1.74, 0.10, side * z);
    }
    // Side skirt along the floor's outer lip: the sealing edge that keeps
    // the low pressure under the floor from being fed by air spilling in
    // from the side, which is most of what makes ground effect work.
    //
    // A flat strip of constant height was standing in for this. The real
    // edge follows the floor's own plan shape, hangs deepest through the
    // middle where the venturi throat is, and rolls up at both ends.
    const SKIRT = [
      { x: -1.42, z: 0.404, drop: 0.020 },
      { x: -1.00, z: 0.626, drop: 0.046 },
      { x: -0.40, z: 0.740, drop: 0.062 },
      { x: 0.35, z: 0.757, drop: 0.066 },
      { x: 1.00, z: 0.725, drop: 0.058 },
      { x: 1.45, z: 0.645, drop: 0.040 },
      { x: 1.80, z: 0.565, drop: 0.022 },
    ];
    loft(SKIRT.map((s) => ({
      x: s.x,
      ring: ring(0.011, s.drop, 0.066 - s.drop * 0.45, 5).map(([yy, zz]) => [yy, zz + side * s.z]),
    })), underbody, 'floor');
    // The edge wing standing above it, turning the flow that gets past.
    plate([[0, 0], [1.42, 0], [1.42, 0.040], [0, 0.058]], 0.012, underbody, 'floor',
      -0.50, 0.070, side * 0.744);
  }

  /* ---------------- front wing ----------------
     Two elements for 2026 on a narrower span, the outboard end swept up
     into the endplate, and the whole assembly slung under a raised nose.
     Endplates sit close to the front tyre's outer face, not well inboard
     of it — checked against real 2026 car photos front-on, where the
     wingtip and the tyre nearly line up. */
  const FW_SPAN = 1.78;
  car.add(wingElement({
    chord: 0.40, thickness: 0.030, span: FW_SPAN, drop: 0.070,
    curve: 0.115, dip: 0.062, taper: 0.66, sweep: 0.075,
    x: -2.70, y: 0.150, tilt: 0.10, mat: body, part: 'frontWing',
  }));
  const frontFlapPivot = new THREE.Group();
  frontFlapPivot.position.set(-2.41, 0.178, 0);
  frontFlapPivot.add(wingElement({
    chord: 0.27, thickness: 0.021, span: FW_SPAN - 0.05, drop: 0.078,
    curve: 0.112, dip: 0.060, taper: 0.60, sweep: 0.070,
    x: 0, y: 0, mat: carbon, part: 'frontFlap',
  }));
  car.add(frontFlapPivot);
  for (const side of [1, -1]) {
    // Endplate, lofted rather than stamped out flat. Close-ups of the
    // real part show a panel that curls outward as it runs back and
    // stands taller at its rear corner; a flat polygon extruded sideways
    // can only ever be a slab hung off the wingtip.
    const EP = [
      { x: -2.745, cy: 0.176, h: 0.052, out: 0.000 },
      { x: -2.640, cy: 0.196, h: 0.084, out: 0.008 },
      { x: -2.500, cy: 0.222, h: 0.108, out: 0.026 },
      { x: -2.370, cy: 0.232, h: 0.106, out: 0.052 },
      { x: -2.270, cy: 0.222, h: 0.082, out: 0.076 },
    ];
    loft(EP.map((s) => ({
      x: s.x,
      ring: ring(0.010, s.h, s.cy, 5)
        .map(([yy, zz]) => [yy, zz + side * (FW_SPAN / 2 + s.out)]),
    })), carbon, 'frontWing');
    // Footplate rolling outward along the bottom edge.
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.013, 0.090), carbon);
    foot.position.set(-2.56, 0.124, side * (FW_SPAN / 2 + 0.040));
    foot.rotation.x = side * 0.26;
    foot.userData.part = 'frontWing';
    car.add(foot);
    // Nose pylons: the wing hangs off the nose rather than growing out of it.
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.20, 0.026), carbon);
    pylon.rotation.z = 0.5;
    pylon.position.set(-2.34, 0.235, side * 0.115);
    pylon.userData.part = 'frontWing';
    car.add(pylon);
  }

  /* ---------------- rear wing ----------------
     Three elements, no beam wing under them, hung from a double mount
     attached to the underside — the published 2026 change from 2022-2025's
     single, curved swan-neck bracket, which built the DRS actuator into
     the bend of the mount itself. */
  const RW_SPAN = 1.02;
  car.add(wingElement({
    chord: 0.32, thickness: 0.026, span: RW_SPAN, drop: 0.055,
    curve: -0.026, taper: 0.80, sweep: 0.030,
    x: 2.02, y: 0.815, tilt: 0.08, mat: body, part: 'rearWing',
  }));
  const rearFlapPivot = new THREE.Group();
  rearFlapPivot.position.set(2.22, 0.855, 0);
  rearFlapPivot.add(wingElement({
    chord: 0.23, thickness: 0.020, span: RW_SPAN - 0.04, drop: 0.062,
    curve: -0.022, taper: 0.78, sweep: 0.026,
    x: 0, y: 0, mat: carbon, part: 'rearFlap',
  }));
  rearFlapPivot.add(wingElement({
    chord: 0.17, thickness: 0.016, span: RW_SPAN - 0.08, drop: 0.050,
    curve: -0.018, taper: 0.76, sweep: 0.022,
    x: 0.03, y: 0.115, mat: carbon, part: 'rearFlap',
  }));
  car.add(rearFlapPivot);
  for (const side of [1, -1]) {
    // Sized to the wing it carries — and it still was not. The previous
    // outline was cut back at the trailing edge but kept its full depth,
    // so it hung 12 cm BELOW the main plane's lower surface and stood
    // 32 cm tall around a wing box 21 cm deep. Rendered from behind, the
    // two of them were a pair of black boards with a red sliver
    // somewhere between them.
    //
    // A 2026 endplate's lower edge sits at the main plane, not a
    // hand's width under it; that deep skirt belongs to the 2017-2021
    // wings. The outline follows the wing instead: bottom edge level
    // with the main plane, a rounded leading edge sweeping up, and a
    // crest a few centimetres proud of the upper flap.
    plate([[0.10, 0.090], [0.26, 0.078], [0.46, 0.096], [0.52, 0.150],
      [0.53, 0.250], [0.50, 0.318], [0.30, 0.336], [0.14, 0.318],
      [0.075, 0.240], [0.062, 0.150]], 0.018, carbon, 'rearWing',
    1.94, 0.690, side * (RW_SPAN / 2));
    // The top edge rolls outward. It is the feature that identifies an
    // endplate at a glance in any photograph of the back of a car, and
    // a flat-topped panel does not read as one however well it is
    // proportioned. Canted 32 degrees, sitting on the crest.
    // It has to START inside the panel, not on top of it: sat on the
    // crest and canted 32 degrees, a 7 cm strip swung out into a
    // free-floating shelf above the wing with daylight under it. Its
    // base is now 4 cm down inside the endplate and the cant is 23
    // degrees, so what shows is a top edge that turns out — which is
    // the whole of the effect being after.
    const roll = plate([[0.28, 0.000], [0.50, 0.012], [0.515, 0.050],
      [0.26, 0.058], [0.13, 0.032]], 0.014, carbon, 'rearWing',
    1.94, 0.986, side * (RW_SPAN / 2));
    roll.rotation.x = side * 0.40;
    // Rain lights down the outer face of each endplate: mandated, and
    // the same on every car.
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.020, 0.170, 0.010),
      new THREE.MeshStandardMaterial({ color: 0xd83228, emissive: 0x5e1108, roughness: 0.5 }),
    );
    strip.position.set(2.02, 0.865, side * (RW_SPAN / 2 + 0.010));
    strip.userData.part = 'rearWing';
    car.add(strip);
  }
  // Double mount: two struts per side reaching the underside of the main
  // plane, the published 2026 change from a single curved bracket with
  // the DRS actuator built into its bend.
  //
  // They used to be short cylinders floating at mid-height — the crash
  // structure's top is around y 0.30 and the struts began at 0.61, so a
  // third of a metre of nothing sat between the mount and the car. These
  // are aimed from one to the other, so they cannot not meet.
  for (const side of [1, -1]) {
    for (const dz of [-0.052, 0.052]) {
      strut(
        new THREE.Vector3(2.06, 0.318, side * 0.088 + dz * 0.5),
        new THREE.Vector3(2.03, 0.812, side * 0.150 + dz),
        0.052, 0.026, carbon, 'rearWing',
      );
    }
  }

  /* ---------------- cockpit and halo ----------------
     The opening has to sit ON the top surface of the survival cell. It
     was twelve centimetres down inside it, so the cockpit rendered as a
     blank patch of bodywork with a helmet floating out of it — the one
     part of the car every photograph shows clearly, and this model was
     not drawing it at all. */
  // The seat pan, lining the floor of the trough so the inside of the
  // cockpit is dark rather than a red-painted dish.
  loft([
    { x: -0.40, ring: ring(0.108, 0.018, 0.512, 4) },
    { x: -0.18, ring: ring(0.138, 0.020, 0.498, 4) },
    { x: 0.02, ring: ring(0.140, 0.020, 0.502, 4) },
    // Narrower than the trough's mouth where it closes, or the pan
    // breaks back out through the bodywork as a shard.
    { x: 0.10, ring: ring(0.074, 0.016, 0.544, 4) },
  ], suit, 'halo');

  // The driver: reclined, shoulders at about the height of the rim, head
  // and helmet standing clear of it. Deliberately a mannequin — the
  // shapes carry scale and tell a reader where a person is, and nothing
  // more detailed than that would be honest at this level of drawing.
  loft([
    { x: -0.20, ring: ring(0.086, 0.052, 0.546, 2.5) },
    { x: -0.08, ring: ring(0.112, 0.066, 0.556, 2.6) },
    { x: 0.03, ring: ring(0.132, 0.074, 0.566, 2.6) },
    { x: 0.08, ring: ring(0.104, 0.060, 0.562, 2.6) },
  ], suit, 'halo');
  // Neck and the head restraint collar sitting on the shoulders.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.070, 14), suit);
  collar.position.set(-0.035, 0.596, 0);
  collar.userData.part = 'halo';
  car.add(collar);

  // Helmet, which is what gives the cockpit its scale. Raised so it sits
  // clear of the rim and level with the halo, as every photograph shows
  // it — it used to be sunk with only its crown showing.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 18), helmetShell);
  helmet.scale.set(1.18, 1, 0.94);
  helmet.position.set(-0.06, 0.658, 0);
  helmet.userData.part = 'halo';
  car.add(helmet);
  // Visor: a band across the front only, not a stripe round the whole
  // shell. phi = 0 faces -x on three's sphere, which is the car's nose.
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.1165, 26, 10,
      -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.34, Math.PI * 0.23),
    visorMat,
  );
  visor.scale.copy(helmet.scale);
  visor.position.copy(helmet.position);
  visor.userData.part = 'halo';
  car.add(visor);

  // Steering wheel: a squared-off rack on a short column, tilted back
  // into the driver's hands, with a display face on the near side.
  const wheelRim = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.112, 0.196), dark);
  wheelRim.position.set(-0.286, 0.594, 0);
  wheelRim.rotation.z = 0.42;
  wheelRim.userData.part = 'halo';
  car.add(wheelRim);
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.052, 0.104), carbon);
  display.position.set(-0.268, 0.606, 0);
  display.rotation.z = 0.42;
  display.userData.part = 'halo';
  car.add(display);
  strut(
    new THREE.Vector3(-0.286, 0.586, 0),
    new THREE.Vector3(-0.196, 0.540, 0),
    0.036, 0.036, carbon, 'halo',
  );

  for (const side of [1, -1]) {
    // Arms, shoulder to wheel rim.
    strut(
      new THREE.Vector3(0.010, 0.578, side * 0.104),
      new THREE.Vector3(-0.268, 0.606, side * 0.072),
      0.052, 0.050, suit, 'halo',
    );
    // Harness, over each shoulder and down to the lap.
    strut(
      new THREE.Vector3(0.098, 0.596, side * 0.062),
      new THREE.Vector3(-0.104, 0.520, side * 0.048),
      0.056, 0.011, dark, 'halo',
    );
  }

  // Halo: one continuous blade from the left rear mount, round the front
  // of the opening, back to the right rear mount — swept as a single part
  // rather than assembled from a hoop plus two legs, because that is how
  // it is actually made and the joins were showing.
  //
  // Checked against real car photos: the rails are a deep, narrow blade
  // at about the height of the top of the helmet, they carry their
  // widest point beside the driver's head, and they drop away steeply
  // into the chassis behind it.
  const haloPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.32, 0.560, 0.208),
    new THREE.Vector3(0.17, 0.672, 0.264),
    new THREE.Vector3(-0.02, 0.734, 0.292),
    new THREE.Vector3(-0.22, 0.752, 0.252),
    new THREE.Vector3(-0.38, 0.750, 0.148),
    new THREE.Vector3(-0.45, 0.742, 0),
    new THREE.Vector3(-0.38, 0.750, -0.148),
    new THREE.Vector3(-0.22, 0.752, -0.252),
    new THREE.Vector3(-0.02, 0.734, -0.292),
    new THREE.Vector3(0.17, 0.672, -0.264),
    new THREE.Vector3(0.32, 0.560, -0.208),
  ], false, 'catmullrom', 0.3);
  sweep(haloPath, 0.021, 0.040, haloMat, 'halo');

  // The central front pillar. Wide seen from the side, thin seen from the
  // driver's seat — the whole point of its section is to cost as little
  // forward vision as a structural member can.
  plate([[-0.052, 0], [0.052, 0], [0.036, 0.200], [-0.036, 0.200]],
    0.038, haloMat, 'halo', -0.45, 0.548, 0);

  /* ---------------- camera and antenna pod ----------------
     On top of the roll hoop, which is where every real car carries it —
     an earlier build had it stuck on the front of the halo, which no
     photograph supports. Mandatory equipment: the same housing in the
     same place on every car on the grid, in one of the two identification
     colours the sport assigns between team-mates. */
  // The housing lies along the car, lens forward, on a black base plate —
  // not across it. A first pass had it as a lateral bar, which no
  // photograph of the real thing supports.
  const podFoot = new THREE.Mesh(new THREE.BoxGeometry(0.186, 0.040, 0.078), haloMat);
  podFoot.position.set(0.340, 0.896, 0);
  podFoot.userData.part = 'camera';
  car.add(podFoot);

  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.172, 18), marker);
  pod.rotation.z = Math.PI / 2;
  pod.position.set(0.310, 0.944, 0);
  pod.userData.part = 'camera';
  car.add(pod);

  const podNose = new THREE.Mesh(new THREE.SphereGeometry(0.030, 18, 12), marker);
  podNose.position.set(0.224, 0.944, 0);
  podNose.userData.part = 'camera';
  car.add(podNose);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.014, 14), dark);
  lens.rotation.z = Math.PI / 2;
  lens.position.set(0.201, 0.944, 0);
  lens.userData.part = 'camera';
  car.add(lens);

  // Three aerial stubs standing on the base plate behind the housing.
  for (const z of [-0.030, 0, 0.030]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.054, 0.012), haloMat);
    fin.position.set(0.418, 0.938, z);
    fin.rotation.z = -0.10;
    fin.userData.part = 'camera';
    car.add(fin);
  }
  // Mirrors. Close-up photographs show these carried well outboard on a
  // long swept fairing, not tucked against the cockpit side — the stalk
  // is a shaped aerodynamic member in its own right and is most of what
  // the eye reads, so a pair of small boxes was never going to do.
  for (const side of [1, -1]) {
    strut(
      new THREE.Vector3(-0.10, 0.602, side * 0.215),
      new THREE.Vector3(-0.30, 0.642, side * 0.410),
      0.070, 0.024, body, 'halo',
    );
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.070, 0.036), body);
    shell.position.set(-0.318, 0.646, side * 0.428);
    shell.rotation.y = side * 0.22;
    shell.userData.part = 'halo';
    car.add(shell);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.058, 0.028), dark);
    glass.position.set(-0.288, 0.646, side * 0.432);
    glass.rotation.y = side * 0.22;
    glass.userData.part = 'halo';
    car.add(glass);
  }

  /* ---------------- wheels, brake ducts and suspension ---------------- */
  function wheel(x, side, rear) {
    const halfWidth = (rear ? 0.405 : 0.355) / 2;
    const z = side * W_HALF;
    const group = new THREE.Group();
    group.position.set(x, AXLE, z);

    // A tyre is a revolved cross-section, not a ring wrapped round a
    // cylinder. The previous build had both: a correct tread cylinder and a
    // torus whose hole axis TorusGeometry puts on local +Z, which a
    // rotation.y then pointed along the car's LENGTH — so every wheel had a
    // stretched ring crossing through it at ninety degrees. Revolving a
    // profile has no axis to get wrong and gives the bead, the sidewall
    // bulge, the shoulder and the crowned tread that make a tyre read.
    const W = halfWidth;
    const profile = [
      [0.232, -W * 0.94],
      [0.268, -W * 1.00],
      [0.316, -W * 0.98],
      [0.348, -W * 0.86],
      [0.359, -W * 0.62],
      [0.362, 0],
      [0.359, W * 0.62],
      [0.348, W * 0.86],
      [0.316, W * 0.98],
      [0.268, W * 1.00],
      [0.232, W * 0.94],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const tyre = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), rubber);
    tyre.rotation.x = Math.PI / 2;
    tyre.userData.part = 'wheel';
    group.add(tyre);

    // Rim: a barrel with a dished outer face rather than a plain disc.
    const rimProfile = [
      [0.150, -W * 0.92],
      [0.228, -W * 0.94],
      [0.230, -W * 0.20],
      [0.230, W * 0.60],
      [0.228, W * 0.94],
      [0.196, W * 0.90],
      [0.120, W * 0.76],
      [0.052, W * 0.72],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const rim = new THREE.Mesh(new THREE.LatheGeometry(rimProfile, 32), alloy);
    rim.rotation.x = Math.PI / 2;
    rim.scale.z = side;
    rim.userData.part = 'wheel';
    group.add(rim);

    // Centre lock and the spokes behind it, so the face is not a blank disc.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.055, 12), alloy);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = side * W * 0.78;
    hub.userData.part = 'wheel';
    group.add(hub);
    for (let i = 0; i < 5; i += 1) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.030, 0.020), carbon);
      spoke.position.set(0, 0, side * W * 0.70);
      spoke.rotation.z = (i / 5) * Math.PI * 2;
      spoke.translateX(0.09);
      spoke.userData.part = 'wheel';
      group.add(spoke);
    }

    // Wheel-body fairing: the rim cover 2026 cars run, set just proud of
    // the rim face rather than floating outside the tyre.
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.186, 0.016, 30), carbon);
    cover.rotation.x = Math.PI / 2;
    cover.position.z = side * W * 0.87;
    cover.userData.part = 'wheel';
    group.add(cover);

    // Brake duct drum, inboard, where it actually sits.
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.182, W * 1.1, 22, 1, true), carbon);
    duct.rotation.x = Math.PI / 2;
    duct.position.z = -side * W * 0.38;
    duct.userData.part = 'wheel';
    group.add(duct);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.150, 0.150, 0.030, 26), dark);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = -side * W * 0.22;
    disc.userData.part = 'wheel';
    group.add(disc);

    car.add(group);
  }

  // A wishbone is an A-arm: two legs from separated points on the chassis
  // converging on one point at the upright. Photographs of the real car
  // head-on show that triangle clearly, and show the legs as flat blades —
  // chord along the airflow, thin top to bottom — because they are
  // aerofoils as much as they are structure. The old build drew each arm
  // as a single round rod, which read as plumbing.
  function wishbone(x, side, y, spread, innerZ, outerZ) {
    for (const dx of [-1, 1]) {
      strut(
        new THREE.Vector3(x + dx * spread, y, side * innerZ),
        new THREE.Vector3(x, y, side * outerZ),
        0.072, 0.017, carbon, 'suspension',
      );
    }
  }

  for (const [x, rear] of [[X_FRONT, false], [X_REAR, true]]) {
    for (const side of [1, -1]) {
      wheel(x, side, rear);
      const outer = rear ? 0.545 : 0.575;
      wishbone(x, side, AXLE + 0.105, 0.175, 0.128, outer);
      wishbone(x, side, AXLE - 0.110, 0.185, 0.140, outer);
      // Track rod at the front, toe link at the rear: one arm, set fore of
      // the lower wishbone, that turns the wheel or holds its angle.
      strut(
        new THREE.Vector3(x + (rear ? 0.24 : -0.24), AXLE - 0.055, side * 0.120),
        new THREE.Vector3(x + (rear ? 0.10 : -0.10), AXLE - 0.055, side * outer),
        0.050, 0.015, carbon, 'suspension',
      );
      // Pushrod: up and inboard from the bottom of the upright to where
      // the springs live under the bodywork.
      strut(
        new THREE.Vector3(x, AXLE - 0.150, side * (outer - 0.02)),
        new THREE.Vector3(x + (rear ? -0.20 : 0.20), AXLE + 0.190, side * 0.105),
        0.042, 0.030, carbon, 'suspension',
      );
    }
  }

  /* ---------------- streamlines ----------------
     Drawn, not solved. Evenly spaced ribbons pushed around the silhouette
     so the shape reads in three dimensions. There is no flow field here and
     the page says so where it counts. */
  const flow = new THREE.Group();
  scene.add(flow);
  const FLOW_LINES = 34;
  const flowMat = new THREE.LineBasicMaterial({ color: 0x9fb2cc, transparent: true, opacity: 0.16 });
  const flowMatHot = new THREE.LineBasicMaterial({ color: 0xdce6f4, transparent: true, opacity: 0.34 });
  const lines = [];
  for (let i = 0; i < FLOW_LINES; i += 1) {
    const geo = new THREE.BufferGeometry();
    const pts = new Float32Array(60 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, i % 7 === 0 ? flowMatHot : flowMat);
    line.userData.seed = Math.random() * 100;
    line.userData.y = 0.05 + Math.random() * 1.1;
    line.userData.z = (Math.random() - 0.5) * 2.7;
    flow.add(line);
    lines.push(line);
  }

  function updateFlow(t) {
    for (const line of lines) {
      const arr = line.geometry.attributes.position.array;
      const { seed, y, z } = line.userData;
      for (let i = 0; i < 60; i += 1) {
        const x = -4.6 + (i / 59) * 10.4 + ((t * 2.2 + seed) % 0.35);
        // Deflection: how far this streamline is pushed aside depends on how
        // close it passes to the body, which is what makes the silhouette read.
        const near = Math.max(0, 1 - Math.abs(x) / 2.6);
        const squeeze = near * Math.max(0, 1 - Math.abs(z) / 1.3);
        arr[i * 3] = x;
        arr[i * 3 + 1] = y + squeeze * 0.5 * Math.sin(1.1 + y) + Math.sin(x * 0.8 + seed) * 0.012;
        arr[i * 3 + 2] = z + squeeze * Math.sign(z || 1) * 0.62;
      }
      line.geometry.attributes.position.needsUpdate = true;
    }
  }
  /* ---------------- orbit, picking, mode ---------------- */

  let orbit = { theta: 0.72, phi: 1.1, radius: 7, dragging: false, lx: 0, ly: 0 };
  let goal = { theta: 0.72, phi: 1.1, radius: 7 };

  // How far back the camera has to sit for the car to fill the frame at
  // whatever shape the chamber happens to be. A fixed distance framed it
  // correctly at exactly one window size and badly at every other.
  // Half-extents in metres, and they are the car's diagonal rather than its
  // length: seen from the front three-quarter it presents about 5.5 m across
  // the frame, and fitting to the 4.9 m floor put the rear wing outside it.
  const FIT_X = 4.7;
  const FIT_Y = 2.05;

  function fitRadius() {
    const aspect = Math.max(0.6, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const vHalf = Math.tan((camera.fov * Math.PI) / 360);
    return Math.max(FIT_X / (vHalf * aspect), FIT_Y / vHalf);
  }

  function applyOrbit() {
    const p = Math.max(0.24, Math.min(1.48, orbit.phi));
    camGoal.set(
      targetGoal.x + orbit.radius * Math.sin(p) * Math.sin(orbit.theta),
      targetGoal.y + orbit.radius * Math.cos(p),
      targetGoal.z + orbit.radius * Math.sin(p) * Math.cos(orbit.theta),
    );
  }

  function onPointerDown(e) {
    orbit.dragging = true;
    orbit.lx = e.clientX;
    orbit.ly = e.clientY;
    orbit.moved = 0;
    canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!orbit.dragging) return;
    const dx = e.clientX - orbit.lx;
    const dy = e.clientY - orbit.ly;
    orbit.moved += Math.abs(dx) + Math.abs(dy);
    goal.theta -= dx * 0.006;
    goal.phi = Math.max(0.24, Math.min(1.48, goal.phi - dy * 0.005));
    orbit.lx = e.clientX;
    orbit.ly = e.clientY;
  }
  function onPointerUp(e) {
    orbit.dragging = false;
    // A drag that barely moved is a click, and a click selects a part.
    if (orbit.moved < 6) pick(e);
  }
  function onWheel(e) {
    e.preventDefault();
    userFramed = true;
    goal.radius = Math.max(2.4, Math.min(15, goal.radius + e.deltaY * 0.006));
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([car, frontFlapPivot, rearFlapPivot], true);
    const hit = hits.find((h) => h.object.userData.part);
    focusOn(hit ? hit.object.userData.part : null, hit ? hit.point : null);
  }

  // Camera behaviour only. The scene has no idea what a part is called or
  // what to say about it — that is aeroRigParts.js's job, consumed by the
  // page component, which is handed the raw part key through onPick.
  let selectedPart = null;
  // Set once the reader zooms by hand, so a later resize does not
  // silently undo it. Clearing a selection is them asking for the whole
  // car back, which counts as handing the framing over again.
  let userFramed = false;

  function focusOn(part, point) {
    selectedPart = part;
    if (!part) {
      userFramed = false;
      goal.radius = fitRadius();
      targetGoal.set(0, 0.44, 0);
      onPick(null);
      return;
    }
    if (point) {
      targetGoal.copy(point);
      goal.radius = 2.9;
    }
    onPick(part);
  }

  /* ---------------- aero mode ---------------- */

  // Angles are a drawing, not a specification. No published source gives a
  // flap angle for either mode, so these are chosen to read clearly and the
  // panel beside them says exactly that.
  const MODE_ANGLE = { Z: { front: -0.42, rear: -0.62 }, X: { front: -0.05, rear: -0.06 } };
  let flapNow = { front: MODE_ANGLE.Z.front, rear: MODE_ANGLE.Z.rear };

  /* ---------------- render loop ---------------- */

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Laid out to nothing yet: dividing by zero here puts NaN in the
    // projection matrix and the canvas never draws again.
    if (w === 0 || h === 0) return;
    // See canvasSize.js: this comparison has to floor, and got it wrong
    // in a way that disabled zoom at fractional device pixel ratios.
    if (needsResize(canvas.width, canvas.height, w, h, renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Re-frame only if the reader has not framed it themselves. A part
      // selection is not the only way that happens — zooming by hand
      // counts too, and rotating a phone used to throw that away.
      if (!selectedPart && !userFramed) goal.radius = fitRadius();
    }
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  let rafId = null;

  function frame() {
    resize();
    t += reduced ? 0 : 0.0075;

    orbit.theta += (goal.theta - orbit.theta) * 0.12;
    orbit.phi += (goal.phi - orbit.phi) * 0.12;
    orbit.radius += (goal.radius - orbit.radius) * 0.09;
    applyOrbit();
    camera.position.lerp(camGoal, 0.14);
    target.lerp(targetGoal, 0.14);
    camera.lookAt(target);

    const want = MODE_ANGLE[currentMode];
    flapNow.front += (want.front - flapNow.front) * 0.09;
    flapNow.rear += (want.rear - flapNow.rear) * 0.09;
    frontFlapPivot.rotation.z = flapNow.front;
    rearFlapPivot.rotation.z = flapNow.rear;

    if (!reduced) updateFlow(t);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  // Stop drawing when nobody can see it. The rig sits at the top of a
  // long page, so a reader who scrolls down to the charts was leaving a
  // WebGL scene animating at full rate off-screen, and a backgrounded
  // tab was doing the same — both are pure battery cost for a picture
  // nobody is looking at.
  let onScreen = true;
  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun && rafId === null) {
      rafId = requestAnimationFrame(frame);
    } else if (!shouldRun && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  const onVisibility = () => sync();
  document.addEventListener('visibilitychange', onVisibility);
  const seen = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    sync();
  });
  seen.observe(canvas);

  goal.radius = fitRadius();
  orbit.radius = goal.radius;
  applyOrbit();
  camera.position.copy(camGoal);
  updateFlow(0);
  // Draw once up front regardless, so the first paint does not wait on
  // the observer's first callback.
  frame();

  return {
    setMode(mode) {
      currentMode = mode === 'X' ? 'X' : 'Z';
    },
    dispose() {
      cancelAnimationFrame(rafId);
      rafId = null;
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const material of materials) {
            if (material.map) material.map.dispose();
            material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
