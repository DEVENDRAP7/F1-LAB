import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { needsResize } from './canvasSize.js';
import { cssToken } from '../theme/palette.js';
import { pinchRadius, spread } from './pinch.js';

// The car is a loaded model, not lofted geometry.
//
// Everything from the nose to the rear wing arrives as one Draco-
// compressed glTF, already cut into the parts aeroRigParts.js names.
// This module's job is what surrounds it: the chamber, the lights, the
// streamlines, the orbit camera, part picking, and the active-aero mode.
//
// scripts/model/segment_car.py builds that file, and its header records
// what the segmentation can and cannot recover.
//
// createAeroRig(canvas, { onPick, onLoadError, verdicts }) builds the
// scene, starts its own render loop, and returns { setMode(mode),
// dispose() }. Selection is driven by clicks inside the scene, which
// both light the part and report it through onPick. It knows
// nothing about what a part is called or what to say about it — see
// aeroRigParts.js for that — it only ever hands back the raw part key a
// click landed on, through onPick.
//
// `verdicts` is the one exception, and a deliberately thin one: a map of
// part key to 'm' | 's' | 'r'. The scene has to know which of three
// classes a part is in to colour it, and it is handed that rather than
// importing the part metadata, so it still knows no names and no prose.
export function createAeroRig(
  canvas,
  { onPick = () => {}, onLoadError = () => {}, verdicts = {} } = {},
) {
  let currentMode = 'OFF';
  /* The chamber is a dark room, opaquely, in both themes.
   *
   * It was transparent, so the page showed through and the "chamber" was
   * whatever colour the document happened to be — near-black in dark
   * mode and mid-grey in light. That was tolerable while the car was
   * just a red object, and it is not now: the car's colours encode a
   * verdict and were stepped against a dark ground, so the ground has to
   * actually be dark rather than follow the page. The scene already had
   * dark fog and a dark floor; it only ever looked light because nothing
   * was painted behind them.
   *
   * Opaque also spares the compositor reading the GL surface back every
   * frame to blend it with the page. */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(new THREE.Color(0x0b0b0c), 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  // Neutral, for the same reason the lights are: a tinted fog is a
  // tint applied by distance.
  scene.fog = new THREE.Fog(0x0b0b0c, 11, 28);

  const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 200);
  const home = new THREE.Vector3(5.2, 2.4, 5.9);
  camera.position.copy(home);

  const target = new THREE.Vector3(0, 0.44, 0);
  const camGoal = home.clone();
  const targetGoal = target.clone();

  /* Every light here is neutral, and that is now a requirement rather
     than a preference.
   *
   * This rig used to be lit like a product shot: a blue ambient, two
   * cold blue rims and a warm orange kicker from the front left. It
   * looked good on a grey car and it is unusable on this one, because
   * the car's colour now encodes what the project knows about each part
   * (see the verdict tokens in tokens.css). A light multiplies the
   * surface colour it falls on, so a blue rim and an orange kicker would
   * push the same panel towards two different verdicts depending only on
   * which way it happened to be facing — the encoding would be decided
   * by the lighting rather than by the data.
   *
   * It is the same argument that makes the lap hero's tube unlit. There
   * the fix was to remove the lighting; here the shape has to be read in
   * three dimensions, so the lights stay and lose their colour instead.
   * Intensities are unchanged, so the modelling is the same as before. */
  scene.add(new THREE.AmbientLight(0x9b9b9b, 0.42));
  const key = new THREE.DirectionalLight(0xffffff, 1.45);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd6d6d6, 1.35);
  rim.position.set(-6, 2.2, -6);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xe6e6e6, 0.9);
  rim2.position.set(7, 1.4, -4);
  scene.add(rim2);
  const fill = new THREE.DirectionalLight(0xbfbfbf, 0.55);
  fill.position.set(-4, 1.2, 6);
  scene.add(fill);
  const under = new THREE.DirectionalLight(0x8e8e8e, 0.16);
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
      color: 0x09090a, roughness: 1, metalness: 0,
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
  /* ---------------- the car ----------------

     Loaded, not lofted.

     Every earlier version of this file built the car by hand: forty
     section tables skinned into lofts, a superellipse ring function, an
     aerofoil generator, and about a thousand lines of geometry. That is
     all gone, and it is worth saying why rather than just deleting it.

     Hand-lofting has a ceiling, and this project hit it. The sections
     put the sidepods five to twenty centimetres CLEAR of the tub, so
     from a three-quarter angle they read as torpedoes lying beside a
     spindle; the wings were planks until they were given real aerofoil
     sections; the airbox needed three separate attempts before it had a
     hole in it, because a closed loft has no hole and anything modelled
     inside is sealed invisibly in the solid.

     The car is now a donor model, re-cut into this page's own parts by
     scripts/model/segment_car.py and loaded here as one compressed glTF.
     It arrives already divided into the thirteen keys aeroRigParts.js
     knows about, because the donor's own eleven meshes are vertex-buffer
     chunks that each span the whole car and would have made every click
     return the same meaningless fragment.

     What this costs: the model is somebody's interpretation of the 2026
     regulations rather than geometry this project derived from them, and
     the page says so plainly instead of claiming otherwise. */

  const car = new THREE.Group();
  scene.add(car);

  // The two movable elements hang off pivots so the active-aero mode can
  // still turn them. Their hinge lines are measured off the loaded
  // geometry rather than hardcoded — a number tuned to the old lofted
  // wing would be wrong for this one, and silently so.
  const frontFlapPivot = new THREE.Group();
  const rearFlapPivot = new THREE.Group();
  car.add(frontFlapPivot);
  car.add(rearFlapPivot);

  const PIVOTS = { frontFlap: frontFlapPivot, rearFlap: rearFlapPivot };

  let disposed = false;

  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  /* ---------------- the car's materials ----------------

     The model arrives with a team's livery baked into it — the source
     concept model is painted red, with a yellow onboard camera — and
     docs/SPEC.md rule 5 forbids liveries outright while DISCLAIMER.md
     promises that every colour here is original. So not one of the
     GLB's thirteen materials is used. They are replaced, and disposed,
     the moment the model lands.

     What replaces them says something instead. Each part already
     carries a verdict — measured, schematic or refused — which is the
     whole reason the car is clickable, and that verdict is now what
     colours it. A reader can see, before clicking anything, that most
     of this car is a drawn shape and only a few parts are things this
     site can actually measure.

     Two material families, because a tyre that is coloured like
     bodywork stops looking like a tyre. Within each family the three
     verdicts differ in hue at the same lightness — see the tokens for
     why lightness cannot be the cue on a lit 3D surface.

     One material instance per mesh rather than one per class, so that
     selecting a part can light that part alone. Thirteen materials is
     nothing, and sharing them would mean selecting the floor also lit
     the diffuser. */
  const TYRE_PARTS = new Set(['wheel']);
  const VERDICT_TOKEN = { m: 'measured', s: 'schematic', r: 'refused' };

  function verdictColours(part) {
    const verdict = VERDICT_TOKEN[verdicts[part]] ?? 'schematic';
    return {
      // The tyre keeps rubber's own colourless dark at every verdict —
      // see the tokens for why it is the one exemption.
      base: TYRE_PARTS.has(part) ? cssToken('--rig-tyre') : cssToken(`--rig-${verdict}`),
      // The full-strength step, used only to light a selected part. The
      // tyre does get this: a selection is momentary and deliberate, so
      // it can afford to stop looking like rubber for as long as it is
      // the thing being asked about.
      lit: cssToken(`--verdict-${verdict}`),
    };
  }

  const carMaterials = [];

  function materialFor(part) {
    const { base } = verdictColours(part);
    const tyre = TYRE_PARTS.has(part);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(base),
      // Rubber is matte and unreflective; bodywork is a smooth painted
      // panel. This is the one place the two families differ beyond
      // colour, and it is what makes a tyre read as one.
      roughness: tyre ? 0.88 : 0.42,
      metalness: tyre ? 0 : 0.12,
    });
    carMaterials.push({ part, material, base });
    return material;
  }

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  loader.load(
    `${import.meta.env.BASE_URL}models/2026/car.glb`,
    (gltf) => {
      // The load is asynchronous and dispose() can win the race. Adding
      // to a torn-down scene leaks the whole graph.
      if (disposed) return;
      const meshes = [];
      gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const mesh of meshes) {
        // The exporter names each object after its part, which is the
        // whole point of the segmentation step.
        const part = mesh.name.replace(/[._]\d+$/, '');
        mesh.userData.part = part;

        // Swap the livery out for the verdict, and release the material
        // that came in the file: nothing else references it, and a
        // dropped GLB material is a leaked GPU texture and program.
        const shipped = mesh.material;
        mesh.material = materialFor(part);
        for (const m of Array.isArray(shipped) ? shipped : [shipped]) {
          if (!m) continue;
          if (m.map) m.map.dispose();
          m.dispose();
        }
        // A part can be selected before the model finishes loading.
        if (selectedPart) applySelection(selectedPart);
        const pivot = PIVOTS[part];
        if (!pivot) {
          car.add(mesh);
          continue;
        }
        // Hinge at the element's own leading edge, mid-height, so the
        // flap rotates about its front edge the way a real one does
        // rather than pivoting about the car's origin.
        const box = new THREE.Box3().setFromObject(mesh);
        pivot.position.set(box.min.x, (box.min.y + box.max.y) / 2, 0);
        mesh.position.sub(pivot.position);
        pivot.add(mesh);
      }
    },
    undefined,
    (err) => {
      // A car that fails to load must not take the page with it: the
      // charts, the readout and the steering wheel are all still worth
      // having, and the viewport says what happened.
      console.error('aero rig: could not load the car model', err);
      onLoadError();
    },
  );
  /* ---------------- streamlines ----------------

     Drawn, not solved. There is no flow field here, no solver and no
     simulation — these are ribbons pushed around the car's measured
     silhouette so its shape reads in three dimensions, and the panel
     beside the viewport says so.

     What changed: they used to be deflected by a fixed ellipse centred
     on the origin, which meant they bulged as much AHEAD of the car as
     behind it and passed straight through the bodywork at any angle
     where you could see it happen. They now follow the car's own
     silhouette, measured off the model every 200 mm — half-width and
     height, which is all a displacement needs. */

  // Scene metres: [x, half-width, height]. Profiled from the loaded
  // model rather than guessed; the peak at x 0.4 is the airbox, the two
  // shoulders at 0.930 and 0.939 are the front and rear track.
  const SILHOUETTE = [
    [-2.60, 0.542, 0.350], [-2.40, 0.900, 0.415], [-2.20, 0.900, 0.467],
    [-2.00, 0.900, 0.528], [-1.80, 0.930, 0.617], [-1.60, 0.930, 0.714],
    [-1.40, 0.931, 0.719], [-1.20, 0.930, 0.672], [-1.00, 0.832, 0.662],
    [-0.80, 0.880, 0.672], [-0.60, 0.881, 0.844], [-0.40, 0.853, 0.884],
    [-0.20, 0.782, 0.877], [0.00, 0.758, 0.836], [0.20, 0.749, 0.789],
    [0.40, 0.741, 1.099], [0.60, 0.737, 1.096], [0.80, 0.731, 1.000],
    [1.00, 0.697, 0.962], [1.20, 0.697, 0.911], [1.40, 0.697, 0.857],
    [1.60, 0.939, 0.801], [1.80, 0.939, 0.791], [2.00, 0.941, 0.719],
    [2.20, 0.939, 0.911], [2.40, 0.822, 0.911], [2.60, 0.575, 0.911],
  ];
  // One smoothing pass over the heights. The raw profile steps 31 cm in
  // a single 20 cm station where the airbox begins, and a linear
  // interpolation through that put a visible corner in every ribbon
  // passing over the roll hoop. The table is a displacement guide, not a
  // measurement anything is derived from, so softening it costs nothing.
  for (let pass = 0; pass < 2; pass += 1) {
    const heights = SILHOUETTE.map((row) => row[2]);
    for (let i = 1; i < SILHOUETTE.length - 1; i += 1) {
      SILHOUETTE[i][2] = heights[i - 1] * 0.25 + heights[i] * 0.5 + heights[i + 1] * 0.25;
    }
  }

  const SIL_X0 = SILHOUETTE[0][0];
  const SIL_STEP = 0.2;

  /** The car's half-width and height at x, zero outside its length. */
  function silhouetteAt(x) {
    const f = (x - SIL_X0) / SIL_STEP;
    if (f <= 0 || f >= SILHOUETTE.length - 1) return [0, 0];
    const i = Math.floor(f);
    const t = f - i;
    const a = SILHOUETTE[i];
    const b = SILHOUETTE[i + 1];
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  const flow = new THREE.Group();
  scene.add(flow);
  const FLOW_LINES = 46;
  const FLOW_STEPS = 76;
  // Quieter than they were. These opacities were set when the car was
  // painted bright red and could hold its own against them; against
  // graphite the same lines read as the subject of the picture and the
  // car as the backdrop.
  const flowMat = new THREE.LineBasicMaterial({ color: 0xa8a8a8, transparent: true, opacity: 0.09 });
  const flowMatHot = new THREE.LineBasicMaterial({ color: 0xe4e4e4, transparent: true, opacity: 0.22 });
  const lines = [];
  for (let i = 0; i < FLOW_LINES; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(FLOW_STEPS * 3), 3));
    const line = new THREE.Line(geo, i % 6 === 0 ? flowMatHot : flowMat);
    const y = 0.04 + Math.random() * 1.25;
    line.userData.seed = Math.random() * 100;
    line.userData.y = y;
    line.userData.z = (Math.random() - 0.5) * 2.9;
    // A streamline either goes OVER the car or AROUND it, and which one
    // it does is decided once rather than per frame. Mixing both into
    // every line was what made the old ribbons wander through the
    // bodywork instead of past it.
    line.userData.over = y > 0.55;
    flow.add(line);
    lines.push(line);
  }

  /** Ease in over the nose and relax through the wake. */
  function envelope(x) {
    if (x < -3.0) return 0;
    if (x < -2.4) return (x + 3.0) / 0.6;
    if (x < 2.4) return 1;
    // The wake does not recover: air behind a car stays disturbed, which
    // is the whole reason the car behind loses downforce.
    return Math.max(0.55, 1 - (x - 2.4) / 5.2);
  }

  function updateFlow(t, flat) {
    // `flat` is 1 when the wings are at rest and 0 when they are loaded,
    // eased by the same lerp the flaps use, so the flow settles as the
    // wings move rather than snapping. A flattened wing turns the air far less, and showing
    // that is the only thing the toggle can honestly say about drag —
    // the size of the difference here is drawn, not computed.
    const upwash = 0.42 * (1 - flat * 0.78);
    const spread = 1 - flat * 0.22;
    for (const line of lines) {
      const arr = line.geometry.attributes.position.array;
      const { seed, y, z, over } = line.userData;
      const sign = Math.sign(z || 1);
      for (let i = 0; i < FLOW_STEPS; i += 1) {
        const x = -4.9 + (i / (FLOW_STEPS - 1)) * 10.9 + ((t * 2.2 + seed) % 0.3);
        const [half, high] = silhouetteAt(x);
        const env = envelope(x);
        let py = y;
        let pz = z;
        if (over) {
          // Pushed up to clear the body, and then up again over the
          // rear wing, which is where a loaded wing throws its wake.
          const clear = high + 0.09 - y;
          if (clear > 0) py = y + clear * env;
          const wing = Math.max(0, 1 - Math.abs(x - 2.25) / 1.5);
          py += wing * upwash * env;
        } else {
          const clear = half + 0.10 - Math.abs(z);
          if (clear > 0) pz = z + sign * clear * env * spread;
          // Air squeezed around the flanks lifts a little too.
          py = y + Math.max(0, 1 - Math.abs(z) / 1.4) * 0.10 * env;
        }
        arr[i * 3] = x;
        arr[i * 3 + 1] = py + Math.sin(x * 0.8 + seed) * 0.012;
        arr[i * 3 + 2] = pz;
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

  const ZOOM_MIN = 2.4;
  const ZOOM_MAX = 15;

  // Every pointer currently down, because a phone has no scroll wheel
  // and zoom has to come from somewhere. One pointer orbits; two pinch.
  // Tracking them in a map rather than with a single dragging flag is
  // what stops a second finger yanking the orbit: before this, both
  // fingers fed the same lx/ly and the car span away on touch-down.
  const pointers = new Map();
  let pinch = null;

  function twoFingerSpread() {
    const [a, b] = [...pointers.values()];
    return spread(a, b);
  }

  function beginOrbitFrom(p) {
    orbit.lx = p.x;
    orbit.ly = p.y;
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      orbit.dragging = true;
      orbit.moved = 0;
      beginOrbitFrom({ x: e.clientX, y: e.clientY });
    } else if (pointers.size === 2) {
      // Anchor the gesture: radius comes from the start distance, not
      // from an accumulated delta. See lib/pinch.js.
      pinch = { dist: twoFingerSpread(), radius: goal.radius };
      orbit.dragging = false;
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      if (pinch) {
        userFramed = true;
        goal.radius = pinchRadius(pinch.radius, pinch.dist, twoFingerSpread(),
          ZOOM_MIN, ZOOM_MAX);
      }
      // A pinch is never a tap, however little either finger travelled.
      orbit.moved = Infinity;
      return;
    }

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
    const wasDragging = orbit.dragging;
    const moved = orbit.moved;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    if (pointers.size === 1) {
      // One finger of a pinch lifted. Carry on orbiting from where the
      // other one is, rather than from where the first one was — which
      // would jump the camera by the width of the gesture.
      const [only] = pointers.values();
      beginOrbitFrom(only);
      orbit.dragging = true;
      orbit.moved = Infinity;
      return;
    }

    orbit.dragging = false;
    // A drag that barely moved is a click, and a click selects a part.
    if (pointers.size === 0 && wasDragging && moved < 6) pick(e);
  }

  function onPointerCancel(e) {
    // The browser can take a touch away — a system gesture, a call. Left
    // in the map, that pointer would keep the rig in a phantom pinch.
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) orbit.dragging = false;
  }

  function onWheel(e) {
    e.preventDefault();
    userFramed = true;
    goal.radius = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, goal.radius + e.deltaY * 0.006));
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
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

  /* The selected part lights up in its own verdict colour.
   *
   * Clicking used to move the camera and nothing else, so on a car where
   * several parts share a verdict there was no way to see which one you
   * had actually picked — the readout named it and the picture did not.
   *
   * Emissive rather than a swapped base colour, because emissive is
   * added after the lighting: the part brightens by the same amount
   * wherever it faces, so a selected panel turned away from the key
   * light still reads as selected. The hue is the full-strength step of
   * the same verdict the readout is naming at that moment. */
  function applySelection(part) {
    for (const entry of carMaterials) {
      const on = entry.part === part;
      entry.material.emissive.set(on ? verdictColours(entry.part).lit : 0x000000);
      entry.material.emissiveIntensity = on ? 0.5 : 0;
    }
  }

  function focusOn(part, point) {
    selectedPart = part;
    applySelection(part);
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

  // Angles are a drawing, not a specification. No published source gives
  // a flap angle for either state, so these are chosen to read clearly
  // and the panel beside them says exactly that. They came down from
  // 0.36/0.34 after reference photographs of a real active-aero change:
  // the difference is modest, and the element stays inside its endplate
  // rather than swinging clear of the car.
  //
  // ZERO rotation is aero ON, because the model's own rest pose is the
  // FLAT one — the rotation loads the wings up rather than flattening
  // them. An older comment here claimed the opposite and the two states
  // were named accordingly, which put both labels on the wrong car: the
  // one called "loaded" was the flat one. Trust the render, not the
  // note.
  const MODE_ANGLE = { ON: { front: 0, rear: 0 }, OFF: { front: 0.24, rear: 0.28 } };
  let flapNow = { front: MODE_ANGLE.OFF.front, rear: MODE_ANGLE.OFF.rear };

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

    // Flow follows the WINGS, not the label: flat is 1 when the
    // elements are at rest and 0 when they are loaded. Reading it off
    // the angle rather than off the mode name is what keeps it correct
    // through the swap above.
    if (!reduced) updateFlow(t, 1 - flapNow.rear / MODE_ANGLE.OFF.rear);
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
      currentMode = mode === 'ON' ? 'ON' : 'OFF';
    },
    dispose() {
      disposed = true;
      draco.dispose();
      cancelAnimationFrame(rafId);
      rafId = null;
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
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
