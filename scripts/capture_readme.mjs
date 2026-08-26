// Capture the README's screenshots from the built site.
//
// Separate from scripts/screenshot.mjs, which exists to catch rendering
// bugs and shoots whole pages at every width. These are the handful of
// framed shots the README links to, written straight into
// docs/screenshots/ so regenerating them is one command rather than a
// manual crop.
//
//   npm run build && npm i --no-save playwright && node scripts/capture_readme.mjs
//
// Resize them afterwards if you like, but do NOT quantise them to a
// palette: on a dark page the few saturated pixels are a rounding error
// to an adaptive palette, and a 256-colour pass turned the medium-tyre
// swatch from yellow into salmon — a screenshot that misreports the
// site's own compound colours.
//
// Chromium is expected at /opt/pw-browsers/chromium.

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const out = new URL('../docs/screenshots', import.meta.url).pathname;
const BASE = '/F1-LAB';
const PORT = 4180;
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
};

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

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function shoot(name, route, prepare, { height = 900 } = {}) {
  const page = await browser.newPage({
    viewport: { width: 1280, height },
    colorScheme: 'dark',
  });
  await page.goto(`http://localhost:${PORT}${BASE}/#${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (prepare) await prepare(page);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
  console.log(`wrote docs/screenshots/${name}.png`);
}

// Anchored on a heading rather than a pixel offset: a shot framed by
// "scroll 1150px" re-frames itself the moment any copy above it changes,
// and the first run of these cut a sentence in half.
const scrollToHeading = async (page, text) => {
  await page.evaluate((needle) => {
    const heading = [...document.querySelectorAll('h2, h3')]
      .find((h) => h.textContent.trim().toLowerCase().startsWith(needle.toLowerCase()));
    if (heading) {
      const panel = heading.closest('.panel') ?? heading;
      window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 12);
    }
  }, text);
  await page.waitForTimeout(350);
};

const check = (count) => async (page) => {
  for (const box of (await page.$$('.driver-chip input')).slice(0, count)) {
    await box.check();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(700);
};

await shoot('ledger', '/', null);
await shoot('strategy', '/strategy', async (page) => {
  await page.selectOption('select', '12');
  await page.waitForTimeout(900);
  await check(3)(page);
});
await shoot('lines', '/lines', async (page) => {
  await check(3)(page);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
});
await shoot('aero', '/aero', (page) => scrollToHeading(page, 'where the load is'));
await shoot('whatif', '/whatif', (page) => scrollToHeading(page, 'change the strategy'));
await shoot('circuits', '/circuits', (page) => scrollToHeading(page, 'circuit'));
await shoot('qualifying', '/qualifying', (page) => scrollToHeading(page, 'head to head'));

await browser.close();
server.close();
