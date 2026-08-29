// Pull the per-team aero signature out of the published racing lines.
//
// Feeds the 3D aero rig with measured numbers instead of remembered ones:
// top speed, the lateral-g envelope by speed band (which is what a
// downforce signature actually looks like when you measure it rather
// than model it), braking g, and the grip the lap implies.
//
//   node scripts/aero_export.mjs > /tmp/aero.json
import fs from 'fs';
import path from 'path';
import { accelerationTrace, lateralEnvelope, peaks } from '../src/lib/aero.js';
import { detectTurns } from '../src/lib/corners.js';
import { impliedGripG } from '../src/lib/cornerModel.js';
import { drivingStyle } from '../src/lib/style.js';

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

// Every published lap, not one per driver. Comparing two cars is
// only fair inside one session at one circuit, so the viewer needs
// the sessions rather than a per-driver best that mixes them.
const rows = [];

for (const round of fs.readdirSync(path.join(ROOT, '2026')).filter((d) => /^\d+$/.test(d))) {
  for (const session of ['Q', 'R']) {
    const dir = path.join(ROOT, '2026', round, session, 'lines');
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
      rows.push({
        code,
        team: teamOf[code] ?? null,
        round: Number(round),
        raceName: raceName[round] ?? null,
        session,
        sessionLabel: manifest.sessionLabel ?? null,
        lapTimeS,
        source: manifest.source ?? null,
        topSpeedKph,
        peakLateralG: pk.peakLateralG,
        peakBrakingG: pk.peakBrakingG,
        impliedGripG: impliedGripG(turns, trace.curvature),
        turns: turns.length,
        slowestCornerKph: turns.length ? Math.min(...turns.map((t) => t.minSpeedKph)) : null,
        fullThrottleShare: style.fullThrottleShare,
        brakingShare: style.brakingShare,
        // The measured downforce signature: lateral g the car actually
        // held in each speed band. A car making aerodynamic grip holds
        // more of it as speed rises; one on mechanical grip runs flat.
        envelope: lateralEnvelope(trace).map((b) => ({
          kph: b.speedKph, g: b.lateralG, samples: b.samples,
        })),
      });
    }
  }
}

rows.sort((a, b) => a.round - b.round || a.session.localeCompare(b.session)
  || (a.team ?? '').localeCompare(b.team ?? '') || a.code.localeCompare(b.code));
console.log(JSON.stringify({ generatedFrom: season.generated_at, drivers: rows }, null, 1));
