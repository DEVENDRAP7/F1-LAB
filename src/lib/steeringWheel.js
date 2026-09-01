// A 2026 Formula 1 steering wheel: what its controls are, and what
// happens when you work them.
//
// ── on the labels ────────────────────────────────────────────────────
// Photographs of real wheels show rotaries ringed with abbreviations —
// REC, CHR, TRQ, KC, FS1, WUS — and it is tempting to reproduce them.
// This does not, because those are teams' internal shorthand and none of
// them publish what the positions actually do. Copying the letters and
// inventing meanings underneath would be the most convincing-looking
// lie on the site.
//
// So the FUNCTIONS here are the real, publicly known ones — an engine
// map, a strategy mode, an engine-braking level, a differential, a brake
// balance — and the positions are named in plain language. The panel
// says as much beside the wheel.
//
// The arrangement is representative too: no team publishes its layout,
// and it changes between teams and between races.

export const CONTROL_KIND = {
  rotary: 'rotary switch',
  position: 'switch position',
  button: 'button',
  toggle: 'latching button',
  paddle: 'paddle',
  rocker: 'thumb rocker',
  display: 'display',
};

const engine = [
  ['LEAN', 'The most conservative map. Least fuel per lap and least stress on the power unit, used when the race has been won or has to be survived.'],
  ['SAVE', 'Fuel saving. Deliberately down on power to bring the car home inside the fuel allowance.'],
  ['STD', 'The standard race map — what a driver spends most of a Grand Prix in.'],
  ['BAL', 'Balanced. A little more than standard, held for a stint rather than a lap.'],
  ['TRQ', 'A torque-biased map: the delivery is shifted low down for traction out of slow corners.'],
  ['PWR', 'A power-biased map, for a circuit or a stretch where top speed is what pays.'],
  ['PUSH', 'Attack. More of everything, at a cost in fuel and temperature that limits how long it can be held.'],
  ['QUAL', 'The qualifying map. Maximum output for one lap, and not intended to last a race distance.'],
];

const strategy = [
  ['RACE', 'The default. Everything set for running in traffic at a sustainable pace.'],
  ['PUSH', 'An attacking phase — the end of a stint, or a gap to build before a pit stop.'],
  ['OVTK', 'Overtake: pairs the strategy mode with maximum electrical deployment to make a pass.'],
  ['DEF', 'Defending. Prioritises exit speed onto the straight where the car behind would attack.'],
  ['TYRE', 'Tyre management. Reduces the loads that overheat a surface, at a cost in lap time.'],
  ['COOL', 'Cooling. Backs everything off to bring temperatures down, usually behind a safety car.'],
  ['WARM', 'Warm-up. Puts energy into the tyres and brakes on an out lap or a formation lap.'],
  ['BOX', 'The in-lap set: pit lane limiter armed, everything readied for a stop.'],
];

const braking = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  const text = n <= 4
    ? `Level ${n} of 12. Little engine braking: the car coasts freely when the driver lifts, which helps a light rear end stay settled into a corner.`
    : n <= 8
      ? `Level ${n} of 12. A middling amount — the setting a driver spends most of a race in, traded off against how stable the rear feels on entry.`
      : `Level ${n} of 12. Strong engine braking: the car slows hard the moment the throttle closes, which loads the rear and can make it nervous.`;
  return [String(n), text];
});

const toPositions = (rows) => rows.map(([label, text]) => ({ label, text }));

export const ROTARIES = [
  {
    id: 'engine',
    label: 'ENGINE',
    name: 'Engine map',
    kind: 'rotary',
    text: 'How hard the internal combustion half of the power unit is worked. Real wheels '
      + 'label these positions in team shorthand nobody publishes, so they are named here '
      + 'by what that kind of map is for.',
    cx: 300, cy: 470, initial: 2,
    positions: toPositions(engine),
  },
  {
    id: 'strategy',
    label: 'STRAT',
    name: 'Strategy mode',
    kind: 'rotary',
    text: 'One switch that moves several things at once — deployment, engine map, '
      + 'differential — so a driver can change the whole car in a corner rather than turning '
      + 'four dials on a straight.',
    cx: 450, cy: 470, initial: 0,
    positions: toPositions(strategy),
  },
  {
    id: 'braking',
    label: 'ENBK',
    name: 'Engine braking',
    kind: 'rotary',
    text: 'How much the power unit slows the car when the driver lifts. It changes how the '
      + 'rear behaves on the way into a corner, which is why it has twelve positions rather '
      + 'than three.',
    cx: 600, cy: 470, initial: 6,
    positions: toPositions(braking),
  },
];

export const BUTTONS = [
  {
    id: 'aero',
    kind: 'toggle',
    label: 'AERO',
    name: 'Active aero · Z to X',
    text: 'Flattens both wings for the straight and loads them again for the corner — the '
      + '2026 change that replaced DRS. The same switch as the Z and X buttons above the car '
      + 'on this page.',
    x: 372, y: 332, r: 26, tone: 'aero',
  },
  {
    id: 'override',
    kind: 'button',
    label: 'OVTK',
    name: 'Override',
    text: 'A burst of extra electrical deployment for a driver trying to pass. It replaces '
      + 'DRS as the overtaking tool, and unlike DRS it can be used anywhere on the lap.',
    x: 528, y: 332, r: 26, tone: 'hot',
  },
  {
    id: 'neutral',
    kind: 'button',
    label: 'N',
    name: 'Neutral',
    text: 'Selects neutral without the clutch — needed at a pit stop and after a stoppage, '
      + 'and required to be reachable by a driver still strapped in.',
    x: 270, y: 186, r: 28, tone: 'go',
  },
  {
    id: 'limiter',
    kind: 'toggle',
    label: 'P',
    name: 'Pit lane speed limiter',
    text: 'Holds the car at the pit lane limit so the driver can brake, stop and leave '
      + 'without watching a speed readout. Required equipment, and forgetting it is a penalty.',
    x: 630, y: 186, r: 28, tone: 'hot',
  },
  {
    id: 'radio',
    kind: 'button',
    label: 'RDIO',
    name: 'Radio',
    text: 'Push to talk to the pit wall. It is held down while speaking, which is why radio '
      + 'clips so often begin mid-sentence.',
    x: 216, y: 254, r: 21, tone: 'hot',
  },
  {
    id: 'drink',
    kind: 'button',
    label: 'DRK',
    name: 'Drink',
    text: 'One pull from the drinks bottle. Ordinary, until you consider that a race is two '
      + 'hours in a fireproof suit in a cockpit that can pass 50°C.',
    x: 684, y: 254, r: 21, tone: 'cool',
  },
  {
    id: 'box',
    kind: 'button',
    label: 'OK',
    name: 'Box confirm',
    text: 'Acknowledges a call to pit, so the crew knows the driver has heard it and is '
      + 'coming in this lap rather than the next.',
    x: 268, y: 332, r: 24, tone: 'cool',
  },
  {
    id: 'bbal',
    kind: 'rocker',
    label: 'BBAL',
    name: 'Brake balance',
    text: 'Shifts braking effort between the front and rear axle, a click at a time. It '
      + 'travels rearward through a race as fuel burns off and the car lightens at the front, '
      + 'so drivers trim it constantly rather than setting it once.',
    x: 296, y: 236, w: 48, h: 26, tone: 'cool',
  },
  {
    id: 'diff',
    kind: 'rocker',
    label: 'DIFF',
    name: 'Differential',
    text: 'How much the rear wheels may turn at different speeds. More lock helps traction '
      + 'out of a slow corner, less helps the car rotate into a fast one — so it is worked '
      + 'corner by corner, not set and left.',
    x: 604, y: 236, w: 48, h: 26, tone: 'cool',
  },
  {
    id: 'marker',
    kind: 'button',
    label: 'MRK',
    name: 'Marker',
    text: 'Drops a marker into the telemetry at the moment the driver presses it, so the '
      + 'engineers can find the corner they were complaining about without hunting for it.',
    x: 632, y: 332, r: 24, tone: 'warn',
  },
];

export const FIXTURES = [
  {
    id: 'display',
    kind: 'display',
    name: 'Display',
    text: 'Gear, speed, lap and sector times, energy state, temperatures, and the modes the '
      + 'rotaries below are set to. It is the only instrument in the car.',
  },
  {
    id: 'leds',
    kind: 'display',
    name: 'Shift lights',
    text: 'A strip that fills across as the engine approaches its limit, so an upshift can be '
      + 'timed without looking away from the corner.',
  },
  {
    id: 'shift',
    kind: 'paddle',
    name: 'Shift paddles',
    text: 'Up on the right, down on the left, both behind the wheel. There is no gear lever '
      + 'and no clutch pedal.',
  },
  {
    id: 'clutch',
    kind: 'paddle',
    name: 'Clutch paddles',
    text: 'Used only to pull away — from the grid, from a pit box, from a stall. Two of them, '
      + 'so a driver can hold a bite point on one and release the other.',
  },
];

export const WHEEL_DEFAULT = {
  name: 'A 2026 steering wheel',
  text: 'Turn the rotaries, press the buttons, and watch the display follow. Every control '
    + 'here is one the real cars carry — the layout is representative, and the switch '
    + 'positions are named in plain language because teams do not publish what their own '
    + 'abbreviations mean.',
};

/** The initial position of every rotary, by id. */
export function initialPositions() {
  return Object.fromEntries(ROTARIES.map((r) => [r.id, r.initial]));
}

/** What to say about a hovered or selected target.
 *
 *  Targets are addressed as "kind:id" — or "pos:rotary:index" for one
 *  position of one rotary — so a single piece of state can point at any
 *  control on the wheel. */
export function describe(target) {
  if (!target) return WHEEL_DEFAULT;
  const [kind, id, index] = String(target).split(':');
  if (kind === 'btn') return BUTTONS.find((b) => b.id === id) ?? WHEEL_DEFAULT;
  if (kind === 'fix') return FIXTURES.find((f) => f.id === id) ?? WHEEL_DEFAULT;
  if (kind === 'rot') return ROTARIES.find((r) => r.id === id) ?? WHEEL_DEFAULT;
  if (kind === 'pos') {
    const rotary = ROTARIES.find((r) => r.id === id);
    const position = rotary?.positions[Number(index)];
    if (!rotary || !position) return WHEEL_DEFAULT;
    return {
      name: `${rotary.name} · ${position.label}`,
      text: position.text,
      kind: 'position',
    };
  }
  return WHEEL_DEFAULT;
}
