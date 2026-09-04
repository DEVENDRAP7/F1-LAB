// What each part of the Aero Rig's schematic car is, and what this
// project can actually say about it.
//
// Every entry carries a verdict: whether the shape itself is drawn from
// the published 2026 regulations ("schematic"), whether something on
// this site actually measures its effect ("measured"), or whether
// nothing published anywhere gives this project a way to say anything
// about it ("refused"). The car is clickable specifically so a reader
// can ask "what about this bit" — the answer should never quietly imply
// more certainty than the site has.

export const VERDICT_LABEL = { m: 'measured', s: 'schematic', r: 'refused' };

export const PARTS = {
  frontWing: {
    name: 'Front wing',
    text: 'Narrower for 2026, with a two-element movable flap. It sets the air up for '
      + 'everything behind it — a change here is felt at the floor and the rear wing too.',
    verdict: ['s', 'shape from a third party’s concept model'],
  },
  frontFlap: {
    name: 'Front flap · movable',
    text: 'The element that moves between modes: loaded in Z, flattened in X. Both wings '
      + 'move in 2026, which is what makes it more than a rebadged DRS. The donor model '
      + 'does not label its elements, so the movable one is found by measurement: the '
      + 'wing’s mass sits at 100-150 mm, thins to almost nothing at 200-250, and '
      + 'returns at 250-300. That gap is the slot, and what moves is the element above it.',
    verdict: ['s', 'shape from a concept model; no flap angle is published'],
  },
  nose: {
    name: 'Nose',
    text: 'Structural, and an air splitter. Everything it does aerodynamically happens '
      + 'downstream, which is why nothing here measures it directly.',
    verdict: ['s', 'shape from a third party’s concept model'],
  },
  floor: {
    name: 'Floor and venturi',
    text: 'Where most of the downforce is made, and the part no channel can see. Its load '
      + 'shows up only as lateral g — which is what the chart below plots.',
    verdict: ['m', 'seen only through measured lateral g'],
  },
  sidepod: {
    name: 'Sidepod',
    text: 'Cooling first, flow conditioning second. The inlet is a heat decision that costs '
      + 'drag, and no source here publishes either side of that trade.',
    verdict: ['r', 'nothing published to measure it with'],
  },
  halo: {
    name: 'Halo',
    text: 'Mandatory survival structure, sitting in the airbox flow. Everything behind it is '
      + 'shaped around that — a real aerodynamic cost of a safety part.',
    verdict: ['s', 'shape from a third party’s concept model'],
  },
  camera: {
    name: 'Camera and antenna pod',
    text: 'The onboard camera housing and its aerials, on top of the roll hoop. Every car '
      + 'carries the same equipment in the same place, in one of two assigned colours to tell '
      + 'team-mates apart — one of the few parts here nobody chose for aerodynamic reasons.',
    verdict: ['s', 'shape from a concept model, not a dimensioned source'],
  },
  airbox: {
    name: 'Airbox and engine cover',
    text: 'Feeds the power unit and tapers into the rear-wing flow. The 2026 power unit '
      + 'shifts far more of its output to the electrical side, changing what this has to cool.',
    verdict: ['s', 'shape from a third party’s concept model'],
  },
  rearWing: {
    name: 'Rear wing',
    text: 'Two elements for 2026, and the beam wing is gone. It trims the balance the '
      + 'floor sets, and it is what most obviously costs top speed. The endplate carries '
      + 'the slots and louvres that let pressure bleed across it, and an outward gurney '
      + 'along its trailing edge.',
    verdict: ['s', 'shape from a third party’s concept model'],
  },
  rearFlap: {
    name: 'Rear flap · movable',
    text: 'The other half of active aero. Flattening it buys straight-line speed; how much '
      + 'it buys is not published anywhere this rig can reach.',
    verdict: ['r', 'no mode delta is published'],
  },
  diffuser: {
    name: 'Diffuser',
    text: 'Expands the floor’s flow back to ambient pressure. Its work is the same as the '
      + 'floor’s and is just as invisible to this data: real, measurable only in what the '
      + 'car could hold in a corner.',
    verdict: ['m', 'seen only through measured lateral g'],
  },
  wheel: {
    name: 'Wheel and tyre',
    text: 'The largest single source of drag, and the only part making mechanical grip. '
      + 'Compound is published; tyre temperature is not, anywhere.',
    verdict: ['m', 'compound published; temperature never'],
  },
  suspension: {
    name: 'Suspension',
    text: 'Aerodynamic as well as mechanical: the arms sit in the flow and are shaped for '
      + 'it. Ride height is where floor performance is won, and none of it is published. Wishbones share their space with the wheels and the bodywork, so this part is only approximately separated from them.',
    verdict: ['r', 'nothing published to measure it with'],
  },
};

export const WHOLE_CAR = {
  name: 'The whole car',
  text: 'Click any part to move in on it. The shape is an open-licence concept model of a '
    + '2026 car by a third-party artist, re-cut into these parts — not a scan of anyone’s '
    + 'real bodywork, and not geometry this project derived itself.',
  verdict: ['s', 'a third party’s concept model, not a dimensioned source'],
};

/** The readout entry for a part key, or the whole-car default for null/unknown. */
export function partInfo(key) {
  return (key && PARTS[key]) || WHOLE_CAR;
}
