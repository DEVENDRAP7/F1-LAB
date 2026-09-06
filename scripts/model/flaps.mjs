// Render the movable elements close up, in both aero modes.
//
//   node scripts/model/flaps.mjs [car-debug.glb]
//
// The Aero Rig's active-aero mode rotates whatever the segmentation put
// in frontFlap and rearFlap. Whether that is one element, three, or half
// the bodywork is a question about geometry, and the only way to answer
// it is to look at the wing from the side, in both positions, with the
// moving part coloured. The page's own camera orbits and cannot be aimed.
//
// Playwright is not a project dependency (see scripts/screenshot.mjs).
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PORT = 4502;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#aab0b8;overflow:hidden}canvas{display:block}
</style>
<script type="importmap">{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}</script></head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const W = 1300, H = 620;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaab0b8);
scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x50565e, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(-2, 4, 6); scene.add(key);

const params = new URLSearchParams(location.search);
const angle = Number(params.get('angle') ?? 0);
const end = params.get('end') ?? 'front';

// The same pivot construction src/lib/aeroRigScene.js uses, so what is
// rendered here is what the page does.
const car = new THREE.Group();
scene.add(car);
const pivots = { frontFlap: new THREE.Group(), rearFlap: new THREE.Group() };
car.add(pivots.frontFlap); car.add(pivots.rearFlap);

const draco = new DRACOLoader();
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.load(params.get('model') ?? '/public/models/2026/car.glb', (gltf) => {
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const part = mesh.name.replace(/[._]\\d+$/, '');
    const pivot = pivots[part];
    // The moving parts are painted so the eye can see what actually turns.
    mesh.material = new THREE.MeshStandardMaterial({
      color: pivot ? 0xff3b30 : 0x9aa3b2,
      roughness: pivot ? 0.35 : 0.75,
      transparent: !pivot,
      // Faint, not merely translucent: the flap sits inside the wing and
      // at 0.9 the surrounding bodywork hid it completely.
      opacity: pivot ? 1 : 0.14,
      depthWrite: !!pivot,
    });
    if (!pivot) { car.add(mesh); continue; }
    const box = new THREE.Box3().setFromObject(mesh);
    pivot.position.set(box.min.x, (box.min.y + box.max.y) / 2, 0);
    mesh.position.sub(pivot.position);
    pivot.add(mesh);
  }
  pivots.frontFlap.rotation.z = end === 'front' ? angle : 0;
  pivots.rearFlap.rotation.z = end === 'rear' ? angle : 0;

  // Side-on, tight on the end being inspected.
  const target = end === 'front'
    ? new THREE.Vector3(-1.95, 0.22, 0)
    : new THREE.Vector3(1.72, 0.72, 0);
  const camera = new THREE.PerspectiveCamera(26, W / H, 0.05, 60);
  camera.position.set(target.x + 0.15, target.y + 0.08, 2.5);
  camera.lookAt(target);
  renderer.render(scene, camera);
  window.__ready = true;
}, undefined, (e) => { window.__error = String(e); window.__ready = true; });
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, 'scripts/model/.flaps.html'), page);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out = path.join(ROOT, 'scripts/model/preview');
fs.mkdirSync(out, { recursive: true });
for (const end of ['front', 'rear']) {
  for (const [name, angle] of [['Z', 0], ['X', end === 'front' ? 0.36 : 0.34]]) {
    const tab = await browser.newPage({ viewport: { width: 1300, height: 620 } });
    const model = process.argv[2] ? `&model=/public/models/2026/${process.argv[2]}` : '';
    await tab.goto(`http://localhost:${PORT}/scripts/model/.flaps.html?end=${end}&angle=${angle}${model}`);
    await tab.waitForFunction('window.__ready === true', { timeout: 60000 });
    const err = await tab.evaluate(() => window.__error);
    if (err) { console.error('load error:', err); process.exitCode = 1; }
    await tab.screenshot({ path: path.join(out, `flap-${end}-${name}.png`) });
    await tab.close();
  }
}
await browser.close();
server.close();
console.log(`wrote ${out}/flap-{front,rear}-{Z,X}.png`);
