// Is the committed aero export still what the committed racing lines produce?
//
//   node scripts/aero_export.mjs --out <scratch>
//   node scripts/check_data_current.mjs <scratch>
//
// public/data/2026/aero.json is generated from .bin files that live in
// the same repository, so the two can disagree — and did. The file was
// written on 2026-08-29 with 88 laps while the traces had since grown to
// 104, which meant `npm run dev` showed an empty car view for the two
// newest rounds. Nothing shipped wrong, because deploy.yml regenerates
// the file before it builds, and that is exactly why the drift could sit
// there for a month without anyone noticing: the only person it hurt was
// whoever ran the site locally.
//
// So this compares CONTENT, not bytes. The export stamps itself with the
// moment it ran, so a byte comparison fails on every single run and says
// nothing. Dropping that one field makes the rest reproducible — checked
// by running the export twice and diffing — which is what lets this be a
// gate rather than a coin toss.
import fs from 'fs';
import { fileURLToPath } from 'url';

// The provenance stamp, and the only field allowed to differ. Anything
// else that varies run to run is a bug in the export, not a thing to
// add to this list.
const VOLATILE = ['generated_at'];

const COMMITTED = fileURLToPath(new URL('../public/data/2026/aero.json', import.meta.url));

function comparable(doc) {
  const copy = { ...doc };
  for (const key of VOLATILE) delete copy[key];
  return JSON.stringify(copy);
}

const freshPath = process.argv[2];
if (!freshPath) {
  console.error('usage: node scripts/check_data_current.mjs <freshly-exported.json>');
  process.exit(2);
}

const committed = JSON.parse(fs.readFileSync(COMMITTED, 'utf8'));
const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'));

if (comparable(committed) === comparable(fresh)) {
  console.log(`[data] aero.json is current: ${committed.laps.length} laps, written ${committed.generated_at}`);
  process.exit(0);
}

// Say what differs, not just that something does. "Run this command" is
// the whole remedy, so it goes in the failure rather than in a wiki.
const lapsOf = (doc) => new Set(doc.laps.map((l) => `${l.round}/${l.session}/${l.code}`));
const was = lapsOf(committed);
const now = lapsOf(fresh);
const added = [...now].filter((k) => !was.has(k));
const removed = [...was].filter((k) => !now.has(k));

console.error('[data] public/data/2026/aero.json is stale.');
console.error(`  committed: ${committed.laps.length} laps, written ${committed.generated_at}`);
console.error(`  the racing lines now yield: ${fresh.laps.length} laps`);
if (added.length) console.error(`  laps the export would gain (${added.length}): ${added.slice(0, 8).join(', ')}${added.length > 8 ? ', …' : ''}`);
if (removed.length) console.error(`  laps it would lose (${removed.length}): ${removed.slice(0, 8).join(', ')}${removed.length > 8 ? ', …' : ''}`);
if (!added.length && !removed.length) console.error('  the same laps, but at least one measured value changed.');
console.error('');
console.error('  Refresh it and commit the result:');
console.error('    node scripts/aero_export.mjs --out public/data/2026/aero.json');
process.exit(1);
