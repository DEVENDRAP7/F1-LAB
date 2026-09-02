// Two scripted runs of the steering wheel, as data.
//
// A demo is a list of keyframes and a rule for reading between them, so
// the whole thing is a pure function of time: stateAt(demo, t). The
// component samples it once per animation frame and pushes the result
// into the wheel; nothing about the timeline needs a browser, which is
// why the sequences below can be tested rather than watched.
//
// ── on the numbers ───────────────────────────────────────────────────
// These are ILLUSTRATIVE. Nobody publishes a real car's gear ratios,
// its shift points, how much a deployment mode is worth, or what the
// clutch is doing off the line, so none of it could be sourced even in
// principle. The speeds and revs here are a plausible shape for a race
// start and an overtake — the right order, the right direction, roughly
// the right spacing — and the panel says so beside the wheel. They are
// not measurements and nothing on the site derives anything from them.

/** Channels that slide between keyframes. Everything else steps. */
const LERP = new Set(['rpm', 'speed', 'clutch', 'throttle']);

export const DEMOS = [
  {
    id: 'start',
    name: 'Race start',
    blurb: 'Neutral on the grid, first gear, the clutch off the bite point, '
      + 'and four upshifts to the first corner.',
    duration: 15,
    frames: [
      { t: 0.0, gear: 0, rpm: 4200, speed: 0, clutch: 1, throttle: 0.15, strategy: 6, engine: 2, override: false, mode: 'Z', caption: 'On the grid, on the warm-up setting: energy into the tyres and brakes. Neutral, clutch paddles pulled in.' },
      { t: 2.2, gear: 0, rpm: 4200, speed: 0, clutch: 1, throttle: 0.15 },
      { t: 2.6, gear: 1, rpm: 4600, speed: 0, clutch: 1, throttle: 0.2, strategy: 0, caption: 'First gear. The clutch is the only thing holding the car.' },
      { t: 3.4, gear: 1, rpm: 11200, speed: 0, clutch: 1, throttle: 1, caption: 'Lights out — revs up against the clutch.' },
      { t: 5.0, gear: 1, rpm: 12600, speed: 0, clutch: 1, throttle: 1 },
      { t: 5.5, gear: 1, rpm: 11000, speed: 12, clutch: 0.35, throttle: 1, caption: 'Clutch released to the bite point. This is where a start is won or lost.' },
      { t: 6.7, gear: 1, rpm: 12500, speed: 82, clutch: 0, throttle: 1 },
      { t: 7.0, gear: 2, rpm: 10300, speed: 86, clutch: 0, throttle: 1, caption: 'Upshift. The revs drop and build again — that is the whole shape of a shift.' },
      { t: 8.1, gear: 2, rpm: 12500, speed: 131 },
      { t: 8.4, gear: 3, rpm: 10500, speed: 135 },
      { t: 9.7, gear: 3, rpm: 12500, speed: 186 },
      { t: 10.0, gear: 4, rpm: 10600, speed: 190 },
      { t: 11.5, gear: 4, rpm: 12500, speed: 241 },
      { t: 11.8, gear: 5, rpm: 10700, speed: 245, caption: 'Fifth, and turn one is already here.' },
      { t: 13.4, gear: 5, rpm: 12300, speed: 284, throttle: 1 },
      { t: 14.2, gear: 5, rpm: 9000, speed: 240, throttle: 0, caption: 'Off the throttle for the corner.' },
      { t: 15.0, gear: 4, rpm: 10200, speed: 198, throttle: 0.2 },
    ],
  },
  {
    id: 'overtake',
    name: 'Active aero · overtake',
    blurb: 'Strategy to OVTK, the override pressed, and X-mode flattening both '
      + 'wings down the straight — then Z-mode again for the braking zone.',
    duration: 17,
    frames: [
      { t: 0.0, gear: 7, rpm: 11200, speed: 288, clutch: 0, throttle: 1, strategy: 0, engine: 2, override: false, mode: 'Z', caption: 'A second behind, in the dirty air, onto the straight.' },
      { t: 2.0, gear: 7, rpm: 11500, speed: 296 },
      { t: 2.6, gear: 7, rpm: 11600, speed: 299, strategy: 2, engine: 6, caption: 'Strategy to OVTK. One switch moves deployment, engine map and differential together.' },
      { t: 3.6, gear: 7, rpm: 11800, speed: 304, override: true, caption: 'Override pressed — a burst of extra electrical deployment. This is what replaced DRS as the overtaking tool.' },
      { t: 4.4, gear: 7, rpm: 12100, speed: 312, mode: 'X', caption: 'X-mode. Both wings flatten: less downforce, and much less drag. Watch the car above.' },
      { t: 5.6, gear: 8, rpm: 10900, speed: 320 },
      { t: 7.6, gear: 8, rpm: 12000, speed: 339 },
      { t: 9.4, gear: 8, rpm: 12600, speed: 352, caption: 'Alongside, and the move is done before the braking board.' },
      { t: 10.6, gear: 8, rpm: 12400, speed: 348, mode: 'Z', override: false, throttle: 1, caption: 'Z-mode. The wings load up again — a car cannot brake or turn on a flattened wing.' },
      { t: 11.4, gear: 8, rpm: 11400, speed: 330, throttle: 0 },
      { t: 12.2, gear: 6, rpm: 11600, speed: 252, throttle: 0, caption: 'Hard on the brakes, downshifting through the box.' },
      { t: 13.0, gear: 4, rpm: 11000, speed: 168, throttle: 0 },
      { t: 13.8, gear: 3, rpm: 10400, speed: 121, throttle: 0.2, strategy: 0, engine: 2, caption: 'Through, and back to RACE for the rest of the lap.' },
      { t: 15.2, gear: 4, rpm: 11200, speed: 172, throttle: 1 },
      { t: 17.0, gear: 5, rpm: 11600, speed: 226, throttle: 1 },
    ],
  },
];

/** One channel's value at time `t`.
 *
 *  Continuous channels slide between the keyframes either side of `t`;
 *  everything else holds the last value set. A channel does not have to
 *  appear in every frame, which is what keeps the tables above readable
 *  — a caption set once stays on screen until another replaces it. */
export function channelAt(frames, key, t) {
  let prev = null;
  let next = null;
  for (const frame of frames) {
    if (frame[key] === undefined) continue;
    if (frame.t <= t) prev = frame;
    else { next = frame; break; }
  }
  if (!prev) return next ? next[key] : undefined;
  if (!next || !LERP.has(key)) return prev[key];
  const span = next.t - prev.t;
  const u = span > 0 ? (t - prev.t) / span : 0;
  return prev[key] + (next[key] - prev[key]) * u;
}

/** Every channel of a demo at time `t`, clamped to its duration. */
export function stateAt(demo, t) {
  const time = Math.max(0, Math.min(demo.duration, t));
  const keys = new Set();
  for (const frame of demo.frames) {
    for (const key of Object.keys(frame)) if (key !== 't') keys.add(key);
  }
  const out = {};
  for (const key of keys) out[key] = channelAt(demo.frames, key, time);
  return out;
}
