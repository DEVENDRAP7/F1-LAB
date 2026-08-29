// Run the aero models over every published lap and print what they do.
//
// The numbers the Aero Explainer quotes about the whole season — "the
// median lap sits 12% off this model", "the median lap has one coasting
// sample and 38 laps have none" — are claims about the published data,
// so they have to be re-derivable rather than remembered. This is what
// produced them, and re-running it is how you check them.
//
// It also settled the drag question. The fit is sound physics and the
// unit tests recover the coefficients it is given from synthetic
// coast-downs; it is the laps that do not carry the samples. One lap of
// 88 cleared the gate, and that one returned a constant term of
// -33 m/s^2 — a 3.4g acceleration while coasting — which is a fit to a
// gradient, not to drag. That is why the panel ships a refusal.
//
//   node scripts/aero_survey.mjs
//
import fs from 'fs';
import path from 'path';
import { accelerationTrace, peaks } from '../src/lib/aero.js';
import { detectTurns } from '../src/lib/corners.js';
import { dragFit, coastIndices } from '../src/lib/drag.js';
import { cornerModel, impliedGripG } from '../src/lib/cornerModel.js';

// Paths are resolved from the repo root, not from scripts/, so the
// script runs the same way from either.
const ROOT = new URL('../public/data/2026', import.meta.url).pathname;
const rows = [];
for (const round of fs.readdirSync(ROOT).filter((d) => /^\d+$/.test(d)).sort((a,b)=>a-b)) {
  for (const session of ['Q', 'R']) {
    const dir = path.join(ROOT, round, session, 'lines');
    const mf = path.join(dir, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (manifest.unavailable) continue;
    for (const [code, entry] of Object.entries(manifest.drivers ?? {})) {
      const buf = fs.readFileSync(path.join(dir, `${code}.bin`));
      const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
      const ch = {};
      manifest.channels.forEach((name, i) => {
        const a = new Int16Array(entry.pointCount);
        for (let p = 0; p < entry.pointCount; p++) a[p] = view[p * manifest.channels.length + i];
        ch[name] = a;
      });
      const scaled = {};
      for (const [name, arr] of Object.entries(ch)) {
        const s = manifest.scale?.[name] ?? 1;
        scaled[name] = s === 1 ? arr : Array.from(arr, (v) => v / s);
      }
      const ds = manifest.spacingM ?? 2;
      const trace = accelerationTrace(scaled, ds);
      if (trace.lateralG.length === 0) continue;
      const coast = coastIndices(trace, scaled);
      const drag = dragFit(trace, scaled);
      const pk = peaks(trace);
      const turns = detectTurns(trace, ds);
      const implied = impliedGripG(turns, trace.curvature);
      const topSpeedKph = Math.max(...trace.speedKph);
      const model = cornerModel(turns, trace.curvature, implied ?? pk.peakLateralG, { topSpeedKph });
      rows.push({
        round, session, code,
        coast: coast.length,
        drag: drag.available
          ? { k: +drag.k.toFixed(6), c: +drag.constantDecel.toFixed(2), r2: +drag.r2.toFixed(2),
              at300: +drag.dragDecelAt(300).toFixed(2), cross: Math.round(drag.crossoverKph),
              span: drag.speedRangeKph.map(Math.round) }
          : drag.reason.slice(0, 60),
        peak: +pk.peakLateralG.toFixed(2),
        implied: implied == null ? null : +implied.toFixed(2),
        turns: turns.length,
        err: model.medianAbsErrorPct == null ? null : +model.medianAbsErrorPct.toFixed(1),
        limited: model.turnsGripLimited,
        modelled: model.turnsModelled,
        power: model.turnsPowerLimited,
      });
    }
  }
}
console.log(JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{'));
console.log('--- laps:', rows.length, 'with drag fit:', rows.filter(r=>typeof r.drag === 'object').length);
