// What the controls on a 2026 Formula 1 steering wheel do.
//
// Every control listed here is one the cars really carry: they are
// visible in broadcast onboards and team media, and several are
// required by the regulations — a pit lane speed limiter, a neutral
// selector, a radio button. What is NOT published is any particular
// team's exact layout, and it changes between teams and between races.
//
// So this is a representative wheel, not a copy of anyone's. The
// arrangement is chosen to read clearly; the controls are real. That
// distinction is stated on the page rather than left for a reader to
// assume, which is the same rule the rest of this project runs on.
//
// Positions are in the SVG's own coordinate space (see SteeringWheel.jsx).

export const CONTROL_KIND = {
  rotary: 'rotary switch',
  button: 'button',
  paddle: 'paddle',
  display: 'display',
};

export const CONTROLS = [
  {
    id: 'diff',
    kind: 'rotary',
    label: 'DIFF',
    name: 'Differential',
    text: 'How much the rear wheels are allowed to turn at different speeds. Drivers change '
      + 'it corner by corner: more lock helps traction out of a slow corner, less helps the '
      + 'car turn into a fast one.',
    x: 84, y: 104,
  },
  {
    id: 'bbal',
    kind: 'rotary',
    label: 'BBAL',
    name: 'Brake balance',
    text: 'Where the braking effort sits between front and rear axle. It moves rearward as '
      + 'fuel burns off and the car gets lighter at the front, so drivers adjust it through '
      + 'the race rather than setting it once.',
    x: 84, y: 168,
  },
  {
    id: 'energy',
    kind: 'rotary',
    label: 'ENRG',
    name: 'Energy mode',
    text: 'How aggressively the hybrid system deploys and recovers. This matters far more in '
      + '2026 than before: the power unit splits its output close to evenly between engine '
      + 'and electrical power, so managing the battery is managing lap time.',
    x: 336, y: 104,
  },
  {
    id: 'mix',
    kind: 'rotary',
    label: 'MIX',
    name: 'Fuel mix',
    text: 'How rich the engine runs. Leaner saves fuel and protects the unit; richer is used '
      + 'for an attack or a defence, and cannot be held for long.',
    x: 336, y: 168,
  },
  {
    id: 'aero',
    kind: 'button',
    label: 'AERO',
    name: 'Active aero · Z to X',
    text: 'Flattens both wings for the straight and loads them again for the corner — the '
      + '2026 change that replaced DRS. It is the same switch as the Z and X buttons above '
      + 'the car on this page.',
    x: 300, y: 226,
  },
  {
    id: 'override',
    kind: 'button',
    label: 'OVTK',
    name: 'Override',
    text: 'The overtake mode: a burst of extra electrical deployment for a driver trying to '
      + 'pass. It replaces DRS as the tool for attacking a car ahead, and unlike DRS it can '
      + 'be used anywhere on the lap.',
    x: 350, y: 226,
  },
  {
    id: 'limiter',
    kind: 'button',
    label: 'PIT',
    name: 'Pit lane speed limiter',
    text: 'Holds the car at the pit lane limit so the driver can brake, stop and leave '
      + 'without watching a speed readout. Required equipment, and forgetting it is a '
      + 'penalty.',
    x: 70, y: 226,
  },
  {
    id: 'radio',
    kind: 'button',
    label: 'RDIO',
    name: 'Radio',
    text: 'Push to talk to the pit wall. It is held down while speaking, which is why radio '
      + 'clips so often start mid-sentence.',
    x: 120, y: 226,
  },
  {
    id: 'neutral',
    kind: 'button',
    label: 'N',
    name: 'Neutral',
    text: 'Selects neutral without the clutch — needed at a pit stop and after a stoppage, '
      + 'and required to be reachable by a driver still strapped in.',
    x: 172, y: 240,
  },
  {
    id: 'drink',
    kind: 'button',
    label: 'DRK',
    name: 'Drink',
    text: 'One pull from the drinks bottle. Ordinary until you consider that a race is two '
      + 'hours in a fireproof suit in a cockpit that can pass 50°C.',
    x: 210, y: 240,
  },
  {
    id: 'box',
    kind: 'button',
    label: 'BOX',
    name: 'Box confirm',
    text: 'Acknowledges a call to pit, so the crew knows the driver has heard it and is '
      + 'coming in this lap rather than the next.',
    x: 248, y: 240,
  },
  {
    id: 'display',
    kind: 'display',
    label: '',
    name: 'Display',
    text: 'Gear, speed, lap and sector times, energy state, temperatures, and whatever page '
      + 'the driver has selected. It is the only instrument in the car.',
    x: 210, y: 150,
  },
  {
    id: 'leds',
    kind: 'display',
    label: '',
    name: 'Shift lights',
    text: 'A strip that runs across as the engine approaches its limit, so an upshift can be '
      + 'timed without looking away from the corner.',
    x: 210, y: 78,
  },
  {
    id: 'shift',
    kind: 'paddle',
    label: '',
    name: 'Shift paddles',
    text: 'Up on the right, down on the left, both behind the wheel. There is no gear lever '
      + 'and no clutch pedal.',
    x: 352, y: 292,
  },
  {
    id: 'clutch',
    kind: 'paddle',
    label: '',
    name: 'Clutch paddles',
    text: 'Used only to pull away — from the grid, from a pit box, from a stall. Two of them, '
      + 'so a driver can hold a bite point on one and release the other.',
    x: 68, y: 292,
  },
];

export const WHEEL_DEFAULT = {
  name: 'A 2026 steering wheel',
  text: 'Hover or tap any control to see what it does. Every control here is one the real '
    + 'cars carry — the layout is representative, because no team publishes theirs.',
};

/** The entry for a control id, or the default when nothing is chosen. */
export function controlInfo(id) {
  return (id && CONTROLS.find((c) => c.id === id)) || WHEEL_DEFAULT;
}
