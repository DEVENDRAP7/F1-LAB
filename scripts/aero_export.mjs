// Pull the per-team aero signature out of the published racing lines.
//
// Feeds the Aero Rig with measured numbers instead of remembered ones:
// top speed, the lateral-g envelope by speed band (which is what a
// downforce signature actually looks like when you measure it rather
// than model it), braking g, and the grip the lap implies.
//
// Every published lap, not one per driver: comparing two cars is only
// fair inside one session at one circuit, so the output carries the
// sessions rather than a per-driver best that would mix them.
//
//   node scripts/aero_export.mjs > public/data/2026/aero.json
//   node scripts/aero_export.mjs --out public/data/2026/aero.json
//
// Run from the deploy workflow, after the telemetry refresh has committed
// whatever racing lines exist and before the site is built, so the rig
// is never more than one deploy behind the published telemetry.
import fs from 'fs';
import path from 'path';
import { accelerationTrace, lateralEnvelope, peaks } from '../src/lib/aero.js';
import { detectTurns } from '../src/lib/corners.js';
import { impliedGripG } from '../src/lib/cornerModel.js';
import { drivingStyle } from '../src/lib/style.js';

const YEAR = 2026;
const SCHEMA_VERSION = 1;

const ROOT = new URL('../public/data', import.meta.url).pathname;
const season = JSON.parse(fs.readFileSync(path.join(ROOT, 'season.json'), 'utf8'));
const standings = JSON.parse(fs.readFileSync(path.join(ROOT, 'standings.json'), 'utf8'));
const teamOf = Object.fromEntries(standings.standings.map((r) => [r.driverCode, r.team]));
const raceName = Object.fromEntries(season.calendar.map((r) => [String(r.round), r.raceName]));

function decode(dir, code, manifest) {
  const entry = manifest.drivers[code];
  const buf = fs.readFileSync(path.join(dir, `${code}.bin`));
  const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const out = {};
  manifest.channels.forEach((name, i) => {
    const scale = manifest.scale?.[name] ?? 1;
    const arr = new Array(entry.pointCount);
    for (let p = 0; p < entry.pointCount; p += 1) {
      arr[p] = view[p * manifest.channels.length + i] / scale;
    }
    out[name] = arr;
  });
  return out;
}

const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

const laps = [];

for (const roundDir of fs.readdirSync(path.join(ROOT, '2026')).filter((d) => /^\d+$/.test(d))) {
  for (const session of ['Q', 'R']) {
    const dir = path.join(ROOT, '2026', roundDir, session, 'lines');
    const mf = path.join(dir, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (manifest.unavailable) continue;
    const ds = manifest.spacingM ?? 2;

    for (const code of Object.keys(manifest.drivers ?? {})) {
      const ch = decode(dir, code, manifest);
      const trace = accelerationTrace(ch, ds);
      if (!trace.lateralG.length) continue;
      const topSpeedKph = Math.max(...trace.speedKph);
      const lapTimeS = manifest.laps?.find((l) => l.code === code)?.lapTimeS ?? null;

      const turns = detectTurns(trace, ds);
      const pk = peaks(trace);
      const style = drivingStyle(ch, trace, ds);
      laps.push({
        code,
        team: teamOf[code] ?? null,
        round: Number(roundDir),
        raceName: raceName[roundDir] ?? null,
        session,
        sessionLabel: manifest.sessionLabel ?? null,
        lapTimeS: round(lapTimeS, 3),
        source: manifest.source ?? null,
        topSpeedKph: round(topSpeedKph, 1),
        peakLateralG: round(pk.peakLateralG, 2),
        peakBrakingG: round(pk.peakBrakingG, 2),
        impliedGripG: round(impliedGripG(turns, trace.curvature), 2),
        turns: turns.length,
        slowestCornerKph: turns.length
          ? round(Math.min(...turns.map((t) => t.minSpeedKph)), 1)
          : null,
        fullThrottleShare: round(style.fullThrottleShare, 3),
        brakingShare: round(style.brakingShare, 3),
        // The measured downforce signature: lateral g the car actually
        // held in each speed band. A car making aerodynamic grip holds
        // more of it as speed rises; one on mechanical grip runs flat.
        envelope: lateralEnvelope(trace).map((b) => ({
          kph: Math.round(b.speedKph),
          g: round(b.lateralG, 2),
          samples: b.samples,
        })),
      });
    }
  }
}

laps.sort((a, b) => a.round - b.round || a.session.localeCompare(b.session)
  || (a.team ?? '').localeCompare(b.team ?? '') || a.code.localeCompare(b.code));

const doc = {
  schemaVersion: SCHEMA_VERSION,
  year: YEAR,
  generated_at: new Date().toISOString(),
  source: 'OpenF1 position and car-data channels, decoded by this project’s own curvature '
    + 'fit and corner model — see src/lib/aero.js and src/lib/cornerModel.js',
  laps,
  limitations: [
    'One lap per driver per session: that driver’s fastest exported lap, on whatever fuel '
      + 'and tyre they were on at the time — not a race average.',
    'Comparable only within one session at one circuit. Circuit, fuel load, tyre and track '
      + 'temperature all move these numbers, so a top speed here is never compared across '
      + 'sessions.',
    'The position feed publishes a handful of drivers per session, not the full field. A team '
      + 'with no lap here has not been exported yet, not measured at zero.',
    'Lateral g is a measurement of the driven lap (v²·κ from the curvature fit), not a '
      + 'downforce figure. Converting it to newtons needs mass, air density and frontal area, '
      + 'none of which any source here publishes.',
  ],
};

const outIndex = process.argv.indexOf('--out');
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
const text = JSON.stringify(doc);
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  process.stderr.write(`[aero] wrote ${laps.length} lap(s) to ${outPath} (${text.length} bytes)\n`);
} else {
  process.stdout.write(text);
}
