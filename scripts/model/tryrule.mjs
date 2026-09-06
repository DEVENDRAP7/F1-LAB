// Try a segmentation rule and look at it, without rebuilding the model.
//
//   node scripts/model/tryrule.mjs front "y>240&&y<360"
//   node scripts/model/tryrule.mjs front --bands 60,120,190,250,320
//
// Re-running segment_car.py to test a rule costs two minutes in Blender.
// This colours the SHIPPED glb per triangle instead, by converting each
// centroid back to the donor's own millimetres, so a rule can be tried in
// a couple of seconds.
//
// The inverse of what segment_car.py applies (scale 0.001, then shift):
//   x_mm      = (x + 1.398) * 1000
//   height_mm = y * 1000          <- no shift: Y_SHIFT is absorbed before
//                                    export, and subtracting it here put
//                                    every height 31 mm low
//   across_mm = z * 1000
//
// Heights spread wider than the rule that cut them, because parts are
// assigned by POLYGON CENTROID: a polygon centred at 241 mm can reach
// down to 174. Read the bands as centres, not as hard edges.
//
// Playwright is not a project dependency (see scripts/screenshot.mjs).
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PORT = 4504;
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

const end = process.argv[2] ?? 'front';
const mode = process.argv[3] === '--bands' ? 'bands' : 'rule';
const arg = process.argv[4] ?? process.argv[3] ?? '';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
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
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaeb5c0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8b93a1, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.9);
key.position.set(-3, 6, 3.5); scene.add(key);
const fill = new THREE.DirectionalLight(0xdce4f2, 0.6);
fill.position.set(3, 1.2, -4); scene.add(fill);

const q = new URLSearchParams(location.search);
const end = q.get('end'), mode = q.get('mode'), arg = q.get('arg') ?? '';
const PARTS = { front: ['frontWing', 'frontFlap', 'nose'], rear: ['rearWing', 'rearFlap'] };
const BAND_COLOURS = [0xe6194b, 0xf58231, 0xffe119, 0x3cb44b, 0x4363d8, 0x911eb4, 0x42d4f4, 0xf032e6];
const bands = mode === 'bands' ? arg.split(',').map(Number) : [];
const test = mode === 'rule' ? new Function('x', 'y', 'z', 'az', 'return (' + (arg || 'false') + ');') : null;

const draco = new DRACOLoader();
draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.load('/public/models/2026/car.glb', (gltf) => {
  // Positions in the buffer are LOCAL. The bounding boxes below are world.
  // Mixing the two coloured almost nothing and looked like a bad rule.
  gltf.scene.updateMatrixWorld(true);
  const wanted = new Set(PARTS[end]);
  const fitTo = new Set(end === 'front' ? ['frontWing', 'frontFlap'] : ['rearWing', 'rearFlap']);
  const box = new THREE.Box3();
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });

  for (const mesh of meshes) {
    const part = mesh.name.replace(/[._]\\d+$/, '');
    if (fitTo.has(part)) box.expandByObject(mesh);
    if (!wanted.has(part)) {
      mesh.material = new THREE.MeshStandardMaterial({ color: 0xb4bac4, roughness: 0.6 });
      continue;
    }
    // Per-triangle colour, so a rule can be seen exactly where it bites.
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    mesh.geometry = geo;
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      let mx = 0, my = 0, mz = 0;
      for (let k = 0; k < 3; k += 1) {
        v.fromBufferAttribute(pos, t + k).applyMatrix4(mesh.matrixWorld);
        mx += v.x; my += v.y; mz += v.z;
      }
      const x = (mx / 3 + 1.398) * 1000;
      const y = (my / 3) * 1000;
      const z = (mz / 3) * 1000;
      let hex = 0xb4bac4;
      if (mode === 'rule') {
        if (test(x, y, z, Math.abs(z))) hex = 0xff3b30;
      } else {
        let i = -1;
        for (let b = 0; b < bands.length - 1; b += 1) if (y >= bands[b] && y < bands[b + 1]) i = b;
        if (i >= 0) hex = BAND_COLOURS[i % BAND_COLOURS.length];
      }
      c.setHex(hex);
      for (let k = 0; k < 3; k += 1) {
        col[(t + k) * 3] = c.r; col[(t + k) * 3 + 1] = c.g; col[(t + k) * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  }
  scene.add(gltf.scene);

  // Diagnostic: the converted extents per part, so a wrong inverse shows
  // up as numbers rather than as a picture with no colour in it.
  const ranges = {};
  for (const mesh of meshes) {
    const part = mesh.name.replace(/[._]\\d+$/, '');
    if (!wanted.has(part)) continue;
    const b = new THREE.Box3().setFromObject(mesh);
    ranges[part] = {
      x: [(b.min.x + 1.398) * 1000, (b.max.x + 1.398) * 1000].map(Math.round),
      y: [b.min.y * 1000, b.max.y * 1000].map(Math.round),
      z: [b.min.z * 1000, b.max.z * 1000].map(Math.round),
    };
  }
  window.__ranges = ranges;

  const size = new THREE.Vector3(); box.getSize(size);
  const mid = new THREE.Vector3(); box.getCenter(mid);
  const fov = 30, aspect = W / H, halfV = Math.tan((fov * Math.PI / 180) / 2);
  const dist = Math.max((size.y * 1.7) / (2 * halfV), (size.z * 0.75) / (2 * halfV * aspect)) * 1.3;
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.03, 80);
  const dir = new THREE.Vector3(end === 'front' ? -0.72 : 0.72, 0.42, 0.55).normalize();
  camera.position.copy(mid).addScaledVector(dir, dist);
  camera.lookAt(mid);
  renderer.render(scene, camera);
  window.__ready = true;
}, undefined, (e) => { window.__error = String(e); window.__ready = true; });
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, 'scripts/model/.tryrule.html'), html);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out = path.join(ROOT, 'scripts/model/preview');
fs.mkdirSync(out, { recursive: true });
const tab = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const url = `http://localhost:${PORT}/scripts/model/.tryrule.html`
  + `?end=${end}&mode=${mode}&arg=${encodeURIComponent(arg)}`;
await tab.goto(url);
await tab.waitForFunction('window.__ready === true', { timeout: 60000 });
const err = await tab.evaluate(() => window.__error);
console.log('converted extents (donor mm):', JSON.stringify(await tab.evaluate(() => window.__ranges), null, 1));
if (err) { console.error('load error:', err); process.exitCode = 1; }
await tab.screenshot({ path: path.join(out, `tryrule-${end}.png`) });
await tab.close();
await browser.close();
server.close();
console.log(`wrote ${out}/tryrule-${end}.png`);
