// Build the site, serve dist/ the way GitHub Pages does, and screenshot
// the pages at desktop and mobile widths — the "render it and look at
// it" step that a passing test suite does not cover. It caught a label
// collision on the stint axis and a console 404 that both the unit
// tests and the production build reported as fine.
//
// Playwright is deliberately NOT a project dependency: it is only needed
// for this manual check, and putting it in package.json would add a
// browser download to every contributor's install and to CI. Run it as:
//
//   npm run build && npm i --no-save playwright && node scripts/screenshot.mjs
//
// Chromium is expected at /opt/pw-browsers/chromium.

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const BASE = '/F1-LAB';
const PORT = 4173;
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
};

// Mirrors how Pages serves a project site: everything under the repo
// name, so a path bug that only shows up at BASE_URL is reproduced here
// rather than hidden by serving from the root.
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(`${BASE}/`)) p = p.slice(BASE.length);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(root, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];

async function openStrategy(page, driverCount) {
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(`http://localhost:${PORT}${BASE}/#/strategy`, { waitUntil: 'networkidle' });
  // Round 12 is the newest race and the one with a matched compound set,
  // so the shot shows the tyre colouring rather than the fallback ramp.
  await page.selectOption('select', '12');
  await page.waitForTimeout(1200);
  const chips = await page.$$('.driver-chip input');
  for (const chip of chips.slice(0, driverCount)) {
    await chip.check();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
await openStrategy(desktop, 3);
await desktop.screenshot({ path: '/tmp/strategy.png', fullPage: true });
const desktopStats = await desktop.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  stintSegments: document.querySelectorAll('.stint-seg').length,
  driverRows: document.querySelectorAll('.stint-row').length,
  hasCanvas: !!document.querySelector('.laptime-chart canvas'),
}));

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
await openStrategy(mobile, 2);
await mobile.screenshot({ path: '/tmp/strategy-mobile.png', fullPage: true });
const mobileStats = await mobile.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));

const light = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
await openStrategy(light, 3);
await light.screenshot({ path: '/tmp/strategy-light.png', fullPage: false });

// Light mode is a selected palette, not an inversion, so every page that
// carries a colour ramp has to be looked at in it — the grip map's light
// steps are different colours, not the dark ones lightened.
for (const [route, name] of [['/aero', 'aero'], ['/whatif', 'whatif'], ['/', 'ledger']]) {
  const l2 = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  await l2.goto(`http://localhost:${PORT}${BASE}/#${route}`, { waitUntil: 'networkidle' });
  await l2.waitForTimeout(900);
  await l2.screenshot({ path: `/tmp/${name}-light.png`, fullPage: true });
  await l2.close();
}

// Every route, so a page that regressed is not missed just because the
// one under active development still renders.
for (const [route, name] of [['/', 'ledger'], ['/circuits', 'circuits'], ['/lines', 'lines'], ['/upcoming', 'upcoming'], ['/errors', 'errors'], ['/aero', 'aero'], ['/whatif', 'whatif']]) {
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'dark' });
  p2.on('response', (r) => r.status() >= 400 && problems.push(`${name} HTTP ${r.status()} ${r.url()}`));
  p2.on('console', (m) => m.type() === 'error' && problems.push(`${name} console: ${m.text()}`));
  p2.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  await p2.goto(`http://localhost:${PORT}${BASE}/#${route}`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(700);
  const ov = await p2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (ov) problems.push(`${name}: horizontal overflow`);
  await p2.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
  await p2.close();
}

// Same routes at phone width — "no overflow" alone is not "looks good",
// so these get eyeballed, not just measured.
for (const [route, name] of [['/', 'ledger'], ['/circuits', 'circuits'], ['/lines', 'lines'], ['/upcoming', 'upcoming'], ['/errors', 'errors'], ['/aero', 'aero'], ['/whatif', 'whatif']]) {
  const m2 = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await m2.goto(`http://localhost:${PORT}${BASE}/#${route}`, { waitUntil: 'networkidle' });
  await m2.waitForTimeout(700);
  const ov = await m2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (ov) problems.push(`${name}@390: horizontal overflow`);
  await m2.screenshot({ path: `/tmp/${name}-mobile.png`, fullPage: true });
  await m2.close();
}

console.log('desktop:', JSON.stringify(desktopStats));
console.log('mobile :', JSON.stringify(mobileStats),
  mobileStats.scrollW > mobileStats.clientW ? 'HORIZONTAL OVERFLOW' : 'no overflow');
console.log('problems:', problems.length ? problems : 'none');
console.log('wrote /tmp/strategy.png, /tmp/strategy-mobile.png, /tmp/strategy-light.png');

await browser.close();
server.close();
