// Render the engine voices to WAV files, offline.
//
//   node scripts/audio_preview.mjs [outDir]
//
// The point: for five rounds this engine was tuned by argument, because
// nothing in the toolchain could listen to it. This drives the REAL
// graph from src/lib/engineAudio.js through an OfflineAudioContext over
// the race-start rev sweep and writes a .wav per voice, so the sound can
// be heard and measured instead of asserted.
//
// engineAudio.js has no imports, so the browser loads the source file
// directly — what is rendered here is what ships, not a copy of it.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = process.argv[2] ?? path.join(ROOT, 'scripts', 'audio');
const PORT = 4810;

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  return fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/scripts/audio/.host.html`).catch(() => {});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.host.html'), '<!doctype html><meta charset=utf-8><body>');
await page.goto(`http://localhost:${PORT}/scripts/audio/.host.html`);

// The rev sweep the race-start demo actually runs, in demo revs.
const SWEEP = [
  [0.0, 4200, 0.15], [2.0, 4200, 0.15], [2.6, 4600, 0.2], [3.4, 11400, 1],
  [5.0, 12900, 1], [5.5, 11600, 1], [6.9, 14850, 1], [7.0, 12100, 1],
  [8.3, 14850, 1], [8.4, 12200, 1], [9.9, 14850, 1], [10.0, 12300, 1],
  [11.7, 14850, 1], [11.8, 12400, 1], [13.4, 14600, 1], [14.2, 9800, 0],
  [15.0, 11000, 0.2],
];

const rendered = await page.evaluate(async ({ sweep, port }) => {
  const mod = await import(`http://localhost:${port}/src/lib/engineAudio.js`);
  const { default: EngineAudio, VOICES } = mod;
  const out = {};
  for (const id of Object.keys(VOICES)) {
    const rate = 44100;
    const seconds = 15.2;
    const ctx = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
    const engine = new EngineAudio();
    engine.start(VOICES[id], ctx);
    for (const [t, rpm, throttle] of sweep) engine.set(rpm, throttle, t);
    const buf = await ctx.startRendering();
    const pcm = buf.getChannelData(0);
    // 16-bit mono WAV.
    const bytes = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); bytes.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVEfmt ');
    bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
    bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true);
    bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
    str(36, 'data'); bytes.setUint32(40, pcm.length * 2, true);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]));
      peak = Math.max(peak, Math.abs(v));
      bytes.setInt16(44 + i * 2, v * 32767, true);
    }
    // Band energies straight off the samples: one-pole splits, then RMS.
    // This is the honest answer to "has it got any bass" — a share of
    // the FFT magnitude can look healthy while the absolute level down
    // there is nothing.
    const band = (cut, high) => {
      const a = Math.exp((-2 * Math.PI * cut) / rate);
      let z = 0; let acc = 0;
      for (let i = 0; i < pcm.length; i++) {
        z = pcm[i] * (1 - a) + z * a;
        const v = high ? pcm[i] - z : z;
        acc += v * v;
      }
      return Math.sqrt(acc / pcm.length);
    };
    // Spectrum of the loudest stretch, for the numbers.
    const an = new OfflineAudioContext(1, 8192, rate);
    let rms = 0;
    for (let i = 0; i < pcm.length; i++) rms += pcm[i] * pcm[i];
    rms = Math.sqrt(rms / pcm.length);
    out[id] = {
      wav: [...new Uint8Array(bytes.buffer)],
      peak: +peak.toFixed(3),
      rms: +rms.toFixed(4),
      low: +band(200, false).toFixed(4),
      high: +band(2000, true).toFixed(4),
    };
  }
  return out;
}, { sweep: SWEEP, port: PORT });

for (const [id, r] of Object.entries(rendered)) {
  const file = path.join(OUT, `engine-${id}.wav`);
  fs.writeFileSync(file, Buffer.from(r.wav));
  const ratio = (r.low / (r.high || 1e-9)).toFixed(1);
  console.log(`${id.padEnd(8)} peak ${String(r.peak).padEnd(6)} rms ${String(r.rms).padEnd(7)}`
    + ` <200Hz ${String(r.low).padEnd(7)} >2kHz ${String(r.high).padEnd(7)} bass:treble ${ratio}:1`);
}
fs.unlinkSync(path.join(OUT, '.host.html'));
await browser.close();
server.close();
console.log(`wrote ${OUT}/engine-*.wav`);
