// Close-up views of both wings, for marking up which elements move.
//
//   node scripts/model/wingviews.mjs
//
// Plain grey, car in its neutral position: the point is to show the
// geometry as it is so somebody can mark on the image which elements
// should be movable. Each wing from directly above and from three
// quarters, framed tight enough that the individual elements read.
//
// The camera is fitted to the parts' own bounding box rather than to
// hand-tuned coordinates. The model has been re-cut more than once, and
// a number tuned to an older export frames the wrong thing silently.
//
// Playwright is not a project dependency (see scripts/screenshot.mjs).
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PORT = 4503;
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
  html,body{margin:0;background:#aeb5c0;overflow:hidden}canvas{display:block}
</style>
<script type="importmap">{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}</script></head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const W = 1600, H = 1000;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeb5c0);

// One key that casts, plus a weak fill. Flat even light was the first
// try and the slot gaps vanished into it — and the slot gaps are the
// whole subject, since they are what separates one element from the next.
scene.add(new THREE.HemisphereLight(0xffffff, 0x8b93a1, 0.95));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(-3, 6, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 24 });
key.shadow.bias = -0.0007;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdce4f2, 0.5);
fill.position.set(3, 1.2, -4);
scene.add(fill);

const params = new URLSearchParams(location.search);
const view = params.get('view');
const region = view.startsWith('front') ? 'front' : 'rear';
const top = view.endsWith('-top');
const PARTS = { front: ['frontWing', 'frontFlap'], rear: ['rearWing', 'rearFlap'] };

const draco = new DRACOLoader();
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.load('/public/models/2026/car.glb', (gltf) => {
  const wanted = new Set(PARTS[region]);
  const box = new THREE.Box3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material = new THREE.MeshStandardMaterial({ color: 0xb4bac4, roughness: 0.58, metalness: 0.06 });
    if (wanted.has(o.name.replace(/[._]\\d+$/, ''))) box.expandByObject(o);
  });
  scene.add(gltf.scene);

  const size = new THREE.Vector3(); box.getSize(size);
  const mid = new THREE.Vector3(); box.getCenter(mid);
  const fov = 30, aspect = W / H;
  const halfV = Math.tan((fov * Math.PI / 180) / 2);
  const spanH = top ? size.z : Math.max(size.x, size.z) * 0.8;
  const spanV = top ? size.x : size.y * 1.6;
  const dist = Math.max(spanV / (2 * halfV), spanH / (2 * halfV * aspect)) * 1.25;

  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.03, 80);
  if (top) {
    camera.position.set(mid.x, mid.y + dist, 0.0001);
    camera.up.set(1, 0, 0);
  } else {
    const dir = new THREE.Vector3(region === 'front' ? -0.66 : 0.66, 0.40, 0.64).normalize();
    camera.position.copy(mid).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(mid);
  renderer.render(scene, camera);
  window.__fit = { view, size: size.toArray().map((n) => +n.toFixed(3)), dist: +dist.toFixed(3) };
  window.__ready = true;
}, undefined, (e) => { window.__error = String(e); window.__ready = true; });
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, 'scripts/model/.wingviews.html'), page);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out = path.join(ROOT, 'scripts/model/preview');
fs.mkdirSync(out, { recursive: true });
for (const view of ['front-top', 'front-3q', 'rear-top', 'rear-3q']) {
  const tab = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await tab.goto(`http://localhost:${PORT}/scripts/model/.wingviews.html?view=${view}`);
  await tab.waitForFunction('window.__ready === true', { timeout: 60000 });
  const err = await tab.evaluate(() => window.__error);
  if (err) { console.error('load error:', err); process.exitCode = 1; }
  console.log(view, JSON.stringify(await tab.evaluate(() => window.__fit)));
  await tab.screenshot({ path: path.join(out, `wing-${view}.png`) });
  await tab.close();
}
await browser.close();
server.close();
console.log(`wrote ${out}/wing-*.png`);
