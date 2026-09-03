// Render the Blender body next to the Three.js-lofted one, and save
// both as PNGs. This is the comparison the prototype exists to produce:
// same camera, same lights, same material intent, different geometry.
//
//   node scripts/model/preview.mjs
//
// Playwright is not a project dependency (see scripts/screenshot.mjs).
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PORT = 4501;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary', '.json': 'application/json',
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

const W = 1200, H = 760;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaab0b8);
const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);

// The same three-light set-up the site's scene uses, so the comparison
// is about geometry and not about lighting.
scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x50565e, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd4ff, 1.1);
rim.position.set(4, 2.5, -3); scene.add(rim);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2; scene.add(ground);

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'q';
// Metres. The car is 5.0 long and 0.95 tall, so a three-quarter view
// needs to sit about 7 out to hold all of it.
const VIEWS = {
  q:    [5.6, 2.4, 4.8],
  side: [0.2, 1.1, 7.4],
  front:[-7.2, 1.5, 1.6],
  top:  [0.2, 8.2, 0.6],
};
camera.position.set(...VIEWS[view]);
camera.lookAt(0, 0.42, 0);

const loader = new GLTFLoader();
loader.load('/public/models/2026/car-body.glb', (gltf) => {
  scene.add(gltf.scene);
  let tris = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh) tris += o.geometry.index
      ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  renderer.render(scene, camera);
  window.__stats = { triangles: Math.round(tris) };
  window.__ready = true;
}, undefined, (e) => { window.__error = String(e); window.__ready = true; });
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, 'scripts/model/.preview.html'), page);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out = path.join(ROOT, 'scripts/model/preview');
fs.mkdirSync(out, { recursive: true });
for (const view of ['q', 'side', 'front', 'top']) {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errs = [];
  tab.on('pageerror', (e) => errs.push(e.message));
  await tab.goto(`http://localhost:${PORT}/scripts/model/.preview.html?view=${view}`);
  await tab.waitForFunction('window.__ready === true', { timeout: 60000 });
  const err = await tab.evaluate(() => window.__error);
  if (err) { console.error('load error:', err); process.exitCode = 1; }
  if (view === 'q') console.log('stats:', await tab.evaluate(() => window.__stats));
  await tab.screenshot({ path: path.join(out, `blender-${view}.png`) });
  await tab.close();
  if (errs.length) console.error(errs.join('\n'));
}
await browser.close();
server.close();
console.log(`wrote ${out}/blender-*.png`);
