import * as THREE from 'three';
import { needsResize } from './canvasSize.js';
import { pinchRadius, spread } from './pinch.js';
import { cssToken } from '../theme/palette.js';
import {
  SPEED_BAND_EDGES,
  buildLapCurtain,
  buildLapTube,
  fitDistance,
  lapExtent,
  openingYaw,
  lapProjection,
} from './lapTerrain.js';

/* The lap, rendered.
 *
 * lapTerrain.js decides where every vertex goes and this file does as it
 * is told, which is the division that lets the geometry be tested
 * without a GPU. Nothing here computes a position from data.
 *
 *
 * WHY THE TUBE IS UNLIT
 *
 * Its colour is the speed band, read off the same ramp and the same band
 * edges as the Racing Lines channel map. A lit material multiplies that
 * colour by however much light happens to fall on that part of the lap,
 * so the far side of a hairpin would render a different colour from the
 * near side at the same speed — the encoding would be destroyed by the
 * lighting. So the tube is MeshBasicMaterial and the colour on screen is
 * exactly the colour the legend names.
 *
 * The shape still reads, because the curtain beneath it is what carries
 * the relief, and that is shaded by its own height rather than by a
 * light.
 *
 *
 * COLOURS COME FROM tokens.css
 *
 * Via palette.js, the one sanctioned bridge. The ramp is not redeclared
 * here, which also means the scene follows a theme change: setPalette()
 * re-reads the tokens and rewrites the colour attributes in place.
 */

const BAND_COUNT = SPEED_BAND_EDGES.length + 1;
const WORLD = 100;

/* The lap sways rather than revolving.
 *
 * A landing page that has to be dragged before it shows anything has not
 * shown anything, so the view moves by itself. It was a full slow
 * revolution first, and that was worse on both counts.
 *
 * It reads badly: a circuit turning all the way round passes through
 * every orientation including the ones that tell you nothing, and by the
 * time it has gone half way the shape a reader was looking at is
 * reversed.
 *
 * And it costs the framing. A circuit is not rotationally symmetric —
 * Monza is about three times longer than it is wide — so a distance that
 * holds it broadside is far more than it needs end-on, and a view fitted
 * to survive a full revolution draws the lap at under half the size the
 * frame allows for most of the turn.
 *
 * A sway of about twenty degrees gives all the parallax needed to read
 * the thing as three-dimensional, keeps the circuit in the orientation
 * it was framed in, and lets the fit be tight. Stopped entirely under
 * prefers-reduced-motion. */
const SWAY_AMPLITUDE = 0.14;
const SWAY_PERIOD_S = 16;

/* How high the camera sits, in radians above the horizon.
 *
 * This is the one number in the scene with a real argument behind it,
 * because the two things worth having pull in opposite directions.
 *
 * Raising the camera makes the lap BIGGER: a circuit's footprint seen
 * from above is more compact, so it fits the frame more efficiently.
 * Sweeping every published lap against the frame's own aspect ratio, the
 * apparent size peaks at about 0.98 rad — 56 degrees, nearly a plan
 * view.
 *
 * And 0.98 would be the wrong answer, because relief projects onto the
 * screen's vertical axis as cos(pitch): at 56 degrees nearly half the
 * elevation is lost into the page, and what is left is a top-down map,
 * which every other page on this site already draws better and in two
 * dimensions. The elevation is the only reason this view exists.
 *
 * So the pitch is chosen low — 96% of the relief still projected —
 * and the size taken as whatever a low camera allows. Measured against
 * the previous 0.42, at 0.30 the mean lap is about a fifth larger across
 * the frame AND keeps more of its relief, so the old value was not even
 * on the trade-off curve. */
const PITCH = 0.3;

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The five band colours, as THREE.Color, straight off the grip ramp. */
function bandColours() {
  return Array.from({ length: BAND_COUNT }, (_, i) => new THREE.Color(cssToken(`--grip-${i + 1}`)));
}

/**
 * Build the scene for one decoded lap and start rendering it.
 *
 * `path` is a decodeLapPath() result. Returns a handle the component
 * uses to resize, pause, retheme and tear down. Every buffer, material
 * and the WebGL context itself is released on dispose(), because this
 * mounts on the landing page and a leaked context there is one the
 * browser will eventually refuse to replace.
 */
export function createLapScene(canvas, path) {
  const extent = lapExtent(path);
  const projection = lapProjection(extent, { worldSize: WORLD });
  const tube = buildLapTube(path, projection);
  const curtain = buildLapCurtain(path, projection);
  if (!tube || !curtain) return null;

  // Opaque, and cleared to the frame's own background token rather than
  // left transparent for the page to show through. A transparent canvas
  // has to be composited with the page every frame, which on a machine
  // without hardware compositing means reading the GL surface back each
  // time — Chromium reports it as "GPU stall due to ReadPixels", and it
  // was the only warning the site logged on any route. The visual result
  // is identical because the clear colour IS the frame's background; it
  // is re-read on a theme change along with everything else.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);

  // Declared here, not next to the render loop that reads it: setPalette
  // runs during construction and sets it, so a `let` further down puts
  // it in the temporal dead zone and construction throws.
  let dirty = true;

  // --- the lap ----------------------------------------------------
  const tubeGeom = new THREE.BufferGeometry();
  tubeGeom.setAttribute('position', new THREE.BufferAttribute(tube.positions, 3));
  tubeGeom.setAttribute('normal', new THREE.BufferAttribute(tube.normals, 3));
  const tubeColours = new THREE.BufferAttribute(new Float32Array(tube.bands.length * 3), 3);
  tubeGeom.setAttribute('color', tubeColours);
  tubeGeom.setIndex(new THREE.BufferAttribute(tube.indices, 1));
  const tubeMesh = new THREE.Mesh(
    tubeGeom,
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );
  group.add(tubeMesh);

  // --- the curtain ------------------------------------------------
  // Alpha lives in the colour attribute (4 components) rather than in a
  // custom shader: the gradient is the only thing it needs to do.
  const curtainGeom = new THREE.BufferGeometry();
  curtainGeom.setAttribute('position', new THREE.BufferAttribute(curtain.positions, 3));
  const curtainColours = new THREE.BufferAttribute(new Float32Array(curtain.heights.length * 4), 4);
  curtainGeom.setAttribute('color', curtainColours);
  curtainGeom.setIndex(new THREE.BufferAttribute(curtain.indices, 1));
  const curtainMesh = new THREE.Mesh(
    curtainGeom,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Both faces: the sheet is seen from inside the loop as often as
      // from outside, and a single-sided curtain vanishes for half the
      // rotation.
      side: THREE.DoubleSide,
      // No depth write, so overlapping stretches of sheet blend instead
      // of one arbitrarily erasing the other.
      depthWrite: false,
    }),
  );
  group.add(curtainMesh);

  // --- start/finish -----------------------------------------------
  // A post at sample 0. The lap is a closed loop with no other feature
  // to orient by, and where it begins is published (the manifest names
  // the lap), so it is worth marking.
  const startGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(tube.centreline[0], 0, tube.centreline[2]),
    new THREE.Vector3(tube.centreline[0], tube.centreline[1] + WORLD * 0.05, tube.centreline[2]),
  ]);
  const startLine = new THREE.Line(startGeom, new THREE.LineBasicMaterial({ transparent: true }));
  group.add(startLine);

  function setPalette() {
    const bands = bandColours();
    for (let v = 0; v < tube.bands.length; v++) {
      const c = bands[Math.min(tube.bands[v], BAND_COUNT - 1)];
      tubeColours.setXYZ(v, c.r, c.g, c.b);
    }
    tubeColours.needsUpdate = true;

    // The sheet is ink, not a hue: the colour channel on this view
    // belongs to speed, and a tinted curtain would be a second encoding
    // competing with it. It fades out towards the floor so the eye
    // reads the top edge — the elevation profile — rather than the
    // block of fill under it.
    //
    // The alpha is low because the sheet is a CLOSED loop and therefore
    // doubles back: any given pixel is usually looking through two
    // layers of it and sometimes four, and those compose. At the first
    // values tried (0.05 rising to 0.35) the overlap accumulated to
    // near-opaque and Spa rendered as a grey slab with the lap buried in
    // it — measured by eye on the one circuit with enough relief to show
    // the fault. These are set so that a doubled-over stretch is still
    // something a reader sees the lap through.
    const ink = new THREE.Color(cssToken('--ink-1'));
    for (let v = 0; v < curtain.heights.length; v++) {
      const h = curtain.heights[v];
      curtainColours.setXYZW(v, ink.r, ink.g, ink.b, 0.015 + 0.145 * h);
    }
    curtainColours.needsUpdate = true;

    startLine.material.color = new THREE.Color(cssToken('--ink-2'));
    startLine.material.opacity = 0.8;

    renderer.setClearColor(new THREE.Color(cssToken('--bg-1')), 1);
    dirty = true;
  }
  setPalette();

  // --- camera -----------------------------------------------------
  const FOV = 42;
  const camera = new THREE.PerspectiveCamera(FOV, 2, 0.5, 4000);
  // Looking at the middle of the relief rather than at the floor, so a
  // hilly circuit is not framed with its climbs running out of the top.
  const target = new THREE.Vector3(0, projection.reliefWorld / 2, 0);
  const targetArray = [target.x, target.y, target.z];

  // Spherical, which is what an orbit is. The elevation is capped below
  // the pole: straight down flattens the view into the 2D map the rest
  // of the site already draws better, and straight on loses the relief.
  // Opened on the angle that turns this circuit's long axis across the
  // frame — see openingYaw. A fixed angle framed half the season badly.
  let baseYaw = openingYaw(extent);
  let yaw = baseYaw;
  let pitch = PITCH;
  let swayT = 0;
  const MIN_PITCH = 0.12;
  const MAX_PITCH = 1.35;

  // The distance that exactly holds the lap depends on the frame's
  // aspect ratio, so it is not a constant: it is recomputed whenever the
  // canvas is resized. `fitted` is that distance and `radius` is where
  // the reader has actually zoomed to — kept as a ratio of the fitted
  // distance, so a resize rescales a zoomed view instead of throwing it
  // away.
  let fitted = 1;
  let zoom = 1;
  let radius = 1;

  /* Fitted for the worst orientation the sway will reach, not just the
   * one in front of us.
   *
   * Fitting the current yaw alone would let the lap slide out of frame
   * partway through the sway and back in again, and a view that breathes
   * in and out reads as a bug even when nothing is actually clipped. So
   * the distance is the largest any angle in the sway needs — a handful
   * of samples across a 40-degree arc, not the whole circle, which is
   * what keeps the framing tight.
   *
   * Recomputed on resize and when a drag ends, both rare, rather than
   * per frame: sampling a few angles over a few thousand points is
   * cheap but it is not free. */
  const FIT_SAMPLES = 7;

  function refit(aspect) {
    let worst = 0;
    for (let i = 0; i < FIT_SAMPLES; i++) {
      const t = (i / (FIT_SAMPLES - 1)) * 2 - 1;
      const d = fitDistance(tube.centreline, tube.count, targetArray, {
        yaw: baseYaw + t * SWAY_AMPLITUDE,
        pitch,
        fovDeg: FOV,
        aspect,
        fill: 0.94,
      });
      if (d > worst) worst = d;
    }
    fitted = worst;
    radius = fitted * zoom;
    camera.far = fitted * 8;
    camera.updateProjectionMatrix();
  }

  function setZoom(next) {
    zoom = Math.min(1.6, Math.max(0.35, next));
    radius = fitted * zoom;
  }

  function placeCamera() {
    dirty = true;
    camera.position.set(
      target.x + radius * Math.cos(pitch) * Math.sin(yaw),
      target.y + radius * Math.sin(pitch),
      target.z + radius * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(target);
  }
  refit(2);
  placeCamera();

  // --- input ------------------------------------------------------
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let spinning = !prefersReducedMotion();
  const pointers = new Map();
  let pinchStart = null;

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      // A reader who has taken hold of it is steering; it should not
      // also be drifting under them.
      spinning = false;
      canvas.setPointerCapture?.(e.pointerId);
    } else if (pointers.size === 2) {
      dragging = false;
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: spread(a, b), zoom };
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      setZoom(pinchRadius(pinchStart.zoom, pinchStart.dist, spread(a, b), 0.35, 1.6));
      placeCamera();
      return;
    }
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.006;
    // The fit is expressed around baseYaw, so a dragged view has to move
    // it too or the next refit would frame an orientation nobody is
    // looking at any more.
    baseYaw = yaw;
    pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
    placeCamera();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      dragging = false;
      // The pitch may have moved, and the fit depends on it. Done on
      // release rather than on every move: the sweep is cheap but not
      // free, and a pointermove fires far more often than a resize.
      refit(camera.aspect);
      placeCamera();
    }
  }

  function onWheel(e) {
    // Only when the pointer is over the canvas AND the gesture is
    // deliberate: a hero at the top of a scrolling page must not eat
    // the scroll that is trying to get past it.
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (1 + e.deltaY * 0.0012));
    placeCamera();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // --- loop -------------------------------------------------------
  let running = true;
  let visible = true;
  let raf = 0;
  let last = 0;

  function onVisibility() {
    visible = document.visibilityState !== 'hidden';
  }
  document.addEventListener('visibilitychange', onVisibility);

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!running || !visible) return;

    if (spinning) {
      swayT += dt;
      yaw = baseYaw + SWAY_AMPLITUDE * Math.sin((swayT / SWAY_PERIOD_S) * Math.PI * 2);
      placeCamera();
    }

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (needsResize(canvas.width, canvas.height, w, h, renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      // A wider frame holds the lap from closer in, so the fit is part
      // of resizing, not something computed once at a guessed aspect.
      refit(camera.aspect);
      placeCamera();
    }

    // Only when the image would actually differ. The loop used to draw
    // every frame whether anything had moved or not, which for a reader
    // who has stopped touching it — or who has prefers-reduced-motion
    // set, so it never moved at all — is a GPU kept busy for sixty
    // identical pictures a second. On the landing page, where this is
    // the first thing mounted, that is the wrong default.
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  return {
    /** Paused while scrolled out of view: this sits on the landing page. */
    setRunning(next) {
      running = next;
    },
    /** Re-read tokens.css after a theme change. */
    setPalette,
    /** What the caption has to state about what was drawn. */
    describe() {
      return {
        reliefM: extent.spanZ,
        exaggeration: projection.exaggeration,
        samples: path.count,
      };
    },
    dispose() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      tubeGeom.dispose();
      curtainGeom.dispose();
      startGeom.dispose();
      tubeMesh.material.dispose();
      curtainMesh.material.dispose();
      startLine.material.dispose();
      renderer.dispose();
    },
  };
}
