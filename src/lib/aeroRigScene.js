import * as THREE from 'three';

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

  const car = new THREE.Group();
  scene.add(car);

  function piece(geo, mat, part, x, y, z) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData.part = part;
    car.add(mesh);
    return mesh;
  }

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
  function aerofoil(chord, thickness, trailingDrop = 0) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(chord * 0.14, thickness, chord * 0.62, thickness * 0.86, chord, -trailingDrop);
    s.bezierCurveTo(chord * 0.6, -trailingDrop - thickness * 0.22,
      chord * 0.2, -thickness * 0.22, 0, 0);
    return s;
  }

  /** An extruded wing element, laid across the span and centred on z. */
  function wingElement(opts) {
    const { chord, thickness, span, drop = 0, x, y, z = 0, tilt = 0, mat, part, curve = 0 } = opts;
    const geo = new THREE.ExtrudeGeometry(aerofoil(chord, thickness, drop), {
      depth: span, bevelEnabled: false, curveSegments: 14,
    });
    geo.translate(0, 0, -span / 2);
    // Spanwise curvature: an F1 wing is not a flat plank, and the arch is
    // most of what makes one read as a wing from three-quarters on.
    if (curve) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i += 1) {
        const zz = p.getZ(i);
        p.setY(i, p.getY(i) + curve * (zz / (span / 2)) ** 2);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    }
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

  const TUB = [
    { x: -1.18, w: 0.176, h: 0.140, cy: 0.386, q: 2.9 },
    { x: -1.02, w: 0.224, h: 0.166, cy: 0.394, q: 3.0 },
    { x: -0.84, w: 0.252, h: 0.184, cy: 0.400, q: 3.0 },
    { x: -0.52, w: 0.274, h: 0.212, cy: 0.418, q: 3.1 },
    { x: -0.18, w: 0.292, h: 0.228, cy: 0.428, q: 3.3 },
    { x: 0.16, w: 0.296, h: 0.234, cy: 0.432, q: 3.3 },
    { x: 0.50, w: 0.286, h: 0.232, cy: 0.436, q: 3.2 },
    { x: 0.86, w: 0.252, h: 0.216, cy: 0.430, q: 3.0 },
    { x: 1.18, w: 0.205, h: 0.186, cy: 0.412, q: 2.8 },
    { x: 1.46, w: 0.152, h: 0.158, cy: 0.396, q: 2.6 },
    { x: 1.72, w: 0.108, h: 0.128, cy: 0.378, q: 2.4 },
    { x: 1.98, w: 0.076, h: 0.100, cy: 0.362, q: 2.3 },
    { x: 2.20, w: 0.056, h: 0.076, cy: 0.350, q: 2.2 },
  ];
  loft(TUB.map((s) => ({ x: s.x, ring: ring(s.w, s.h, s.cy, s.q) })), body, 'floor');

  /* ---------------- engine cover and airbox ----------------
     A separate volume sitting on the tub: the intake mouth behind the
     driver's head, tapering into the spine that feeds the rear wing. */
  // The roll hoop stands BEHIND the driver's head, not over it — checked
  // against side-on and overhead photographs of the real car, where the
  // helmet sits clear in front of the intake and the hoop rises behind
  // the headrest. An earlier build had the apex at the same station as
  // the helmet, which put the intake in front of the driver's face.
  const COVER = [
    { x: 0.06, w: 0.006, h: 0.006, cy: 0.665, q: 2.0 },
    { x: 0.16, w: 0.098, h: 0.104, cy: 0.694, q: 2.0 },
    { x: 0.34, w: 0.150, h: 0.152, cy: 0.700, q: 2.1 },
    { x: 0.58, w: 0.170, h: 0.148, cy: 0.676, q: 2.3 },
    { x: 0.86, w: 0.164, h: 0.134, cy: 0.626, q: 2.5 },
    { x: 1.14, w: 0.136, h: 0.112, cy: 0.566, q: 2.6 },
    { x: 1.46, w: 0.098, h: 0.086, cy: 0.506, q: 2.5 },
    { x: 1.80, w: 0.060, h: 0.058, cy: 0.452, q: 2.4 },
    { x: 2.14, w: 0.034, h: 0.038, cy: 0.414, q: 2.3 },
  ];
  loft(COVER.map((s) => ({ x: s.x, ring: ring(s.w, s.h, s.cy, s.q) })), body, 'airbox');
  // The intake mouth, dark so it reads as an opening rather than as bodywork.
  loft([
    { x: 0.16, ring: ring(0.072, 0.064, 0.700, 2.0) },
    { x: 0.30, ring: ring(0.066, 0.058, 0.704, 2.0) },
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
    // Inlet, set into the leading face.
    loft([
      { x: -0.60, ring: ring(0.064, 0.086, 0.302, 2.6).map(([y, z]) => [y, z + side * 0.512]) },
      { x: -0.44, ring: ring(0.058, 0.078, 0.304, 2.6).map(([y, z]) => [y, z + side * 0.512]) },
    ], dark, 'sidepod', { capFront: false });
  }

  /* ---------------- details that the eye looks for ----------------
     Not decoration: a car without a cockpit opening, a radiator exit or a
     gearbox reads as a shape rather than as a machine. */

  // Headrest padding around the cockpit opening.
  loft([
    { x: -0.02, ring: ring(0.190, 0.058, 0.556, 3.0) },
    { x: 0.14, ring: ring(0.196, 0.066, 0.560, 3.0) },
    { x: 0.28, ring: ring(0.176, 0.058, 0.552, 3.0) },
  ], dark, 'halo');

  // Sidepod inlet: a real opening set into the leading face, with a lip.
  for (const side of [1, -1]) {
    loft([
      { x: -0.58, ring: ring(0.070, 0.094, 0.302, 2.4).map(([y, z]) => [y, z + side * 0.512]) },
      { x: -0.50, ring: ring(0.062, 0.084, 0.304, 2.4).map(([y, z]) => [y, z + side * 0.510]) },
      { x: -0.36, ring: ring(0.044, 0.062, 0.308, 2.4).map(([y, z]) => [y, z + side * 0.508]) },
    ], dark, 'sidepod', { capFront: false });
    // Radiator exit louvre along the pod shoulder.
    plate([[0, 0], [0.72, 0], [0.72, 0.030], [0, 0.038]], 0.012, dark, 'sidepod',
      0.30, 0.398, side * 0.520);
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
  const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.055),
    new THREE.MeshStandardMaterial({ color: 0xff2a1e, emissive: 0x5a0f08, roughness: 0.5 }));
  rainLight.position.set(2.36, 0.272, 0);
  rainLight.userData.part = 'diffuser';
  car.add(rainLight);

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
    // Floor edge fences, along the outer lip.
    plate([[0, 0], [1.5, 0], [1.5, 0.055], [0, 0.075]], 0.014, underbody, 'floor',
      -0.55, 0.062, side * 0.742);
  }

  /* ---------------- front wing ----------------
     Two elements for 2026 on a narrower span, the outboard end swept up
     into the endplate, and the whole assembly slung under a raised nose.
     Endplates sit close to the front tyre's outer face, not well inboard
     of it — checked against real 2026 car photos front-on, where the
     wingtip and the tyre nearly line up. */
  const FW_SPAN = 1.78;
  car.add(wingElement({
    chord: 0.36, thickness: 0.032, span: FW_SPAN, drop: 0.055, curve: 0.034,
    x: -2.68, y: 0.128, tilt: 0.10, mat: body, part: 'frontWing',
  }));
  const frontFlapPivot = new THREE.Group();
  frontFlapPivot.position.set(-2.40, 0.150, 0);
  frontFlapPivot.add(wingElement({
    chord: 0.26, thickness: 0.024, span: FW_SPAN - 0.04, drop: 0.062, curve: 0.028,
    x: 0, y: 0, mat: carbon, part: 'frontFlap',
  }));
  car.add(frontFlapPivot);
  for (const side of [1, -1]) {
    plate([[0.04, 0.02], [0.30, 0], [0.52, 0.06], [0.54, 0.24], [0.36, 0.29],
      [0.06, 0.17]], 0.020, carbon, 'frontWing', -2.72, 0.10, side * (FW_SPAN / 2));
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
    chord: 0.30, thickness: 0.028, span: RW_SPAN, drop: 0.045, curve: -0.014,
    x: 2.02, y: 0.815, tilt: 0.08, mat: body, part: 'rearWing',
  }));
  const rearFlapPivot = new THREE.Group();
  rearFlapPivot.position.set(2.22, 0.855, 0);
  rearFlapPivot.add(wingElement({
    chord: 0.22, thickness: 0.022, span: RW_SPAN - 0.03, drop: 0.055, curve: -0.012,
    x: 0, y: 0, mat: carbon, part: 'rearFlap',
  }));
  rearFlapPivot.add(wingElement({
    chord: 0.17, thickness: 0.018, span: RW_SPAN - 0.06, drop: 0.046, curve: -0.010,
    x: 0.03, y: 0.115, mat: carbon, part: 'rearFlap',
  }));
  car.add(rearFlapPivot);
  for (const side of [1, -1]) {
    plate([[0, 0.02], [0.30, 0], [0.66, 0.04], [0.68, 0.24], [0.52, 0.35],
      [0.12, 0.35], [0, 0.18]], 0.020, carbon, 'rearWing', 1.94, 0.69, side * (RW_SPAN / 2));
  }
  // Double mount: a pair of straighter struts per side rising to the
  // underside of the main plane, rather than one curved bracket — the
  // published 2026 change moved the DRS actuator off the mount itself,
  // so the mount no longer has to be shaped around it.
  for (const side of [1, -1]) {
    for (const dz of [-0.05, 0.05]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.026, 0.21, 8), carbon);
      strut.rotation.x = 0.16;
      strut.rotation.z = side * -0.08;
      strut.position.set(2.00, 0.715, side * 0.150 + dz);
      strut.userData.part = 'rearWing';
      car.add(strut);
    }
    // A small fairing where the struts meet the crash structure, so the
    // mount reads as attached rather than as two rods stuck in mid-air.
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.13), carbon);
    foot.position.set(2.00, 0.615, side * 0.150);
    foot.userData.part = 'rearWing';
    car.add(foot);
  }

  /* ---------------- cockpit and halo ---------------- */
  loft([
    { x: -0.40, ring: ring(0.175, 0.048, 0.500, 3.0) },
    { x: -0.20, ring: ring(0.212, 0.054, 0.520, 3.2) },
    { x: 0.02, ring: ring(0.208, 0.054, 0.526, 3.2) },
  ], dark, 'halo', { capFront: false, capBack: false });
  // Driver helmet, which is what gives the cockpit its scale.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), alloy);
  helmet.scale.set(1.18, 1, 0.94);
  helmet.position.set(-0.06, 0.590, 0);
  helmet.userData.part = 'halo';
  car.add(helmet);

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
  podFoot.position.set(0.330, 0.858, 0);
  podFoot.userData.part = 'camera';
  car.add(podFoot);

  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.172, 18), marker);
  pod.rotation.z = Math.PI / 2;
  pod.position.set(0.300, 0.906, 0);
  pod.userData.part = 'camera';
  car.add(pod);

  const podNose = new THREE.Mesh(new THREE.SphereGeometry(0.030, 18, 12), marker);
  podNose.position.set(0.214, 0.906, 0);
  podNose.userData.part = 'camera';
  car.add(podNose);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.014, 14), dark);
  lens.rotation.z = Math.PI / 2;
  lens.position.set(0.191, 0.906, 0);
  lens.userData.part = 'camera';
  car.add(lens);

  // Three aerial stubs standing on the base plate behind the housing.
  for (const z of [-0.030, 0, 0.030]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.054, 0.012), haloMat);
    fin.position.set(0.408, 0.900, z);
    fin.rotation.z = -0.10;
    fin.userData.part = 'camera';
    car.add(fin);
  }
  // Mirrors, small but the eye misses them.
  for (const side of [1, -1]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.016, 0.10), carbon);
    stalk.position.set(-0.18, 0.545, side * 0.30);
    stalk.userData.part = 'halo';
    car.add(stalk);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.062, 0.020), dark);
    glass.position.set(-0.23, 0.555, side * 0.345);
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

  function wishbone(x, side, y, sweep, len) {
    for (const dx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.021, len, 8), carbon);
      arm.position.set(x + dx * sweep, y, side * (W_HALF - len / 2 + 0.06));
      arm.rotation.x = Math.PI / 2;
      arm.rotation.y = dx * 0.34;
      arm.userData.part = 'suspension';
      car.add(arm);
    }
  }

  for (const [x, rear] of [[X_FRONT, false], [X_REAR, true]]) {
    for (const side of [1, -1]) {
      wheel(x, side, rear);
      wishbone(x, side, AXLE + 0.10, 0.16, 0.50);
      wishbone(x, side, AXLE - 0.11, 0.17, 0.52);
      // Pushrod, running in from the wheel to the chassis.
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.46, 8), carbon);
      rod.position.set(x + (rear ? -0.10 : 0.10), AXLE + 0.02, side * 0.46);
      rod.rotation.x = Math.PI / 2.5 * side;
      rod.rotation.z = 0.3;
      rod.userData.part = 'suspension';
      car.add(rod);
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

  function focusOn(part, point) {
    selectedPart = part;
    if (!part) {
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
    if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Only re-frame when the reader has not zoomed somewhere themselves.
      if (!selectedPart) goal.radius = fitRadius();
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
  goal.radius = fitRadius();
  orbit.radius = goal.radius;
  applyOrbit();
  camera.position.copy(camGoal);
  updateFlow(0);
  frame();

  return {
    setMode(mode) {
      currentMode = mode === 'X' ? 'X' : 'Z';
    },
    dispose() {
      cancelAnimationFrame(rafId);
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
