// The site's map, in one place.
//
// The nav and the home page were each carrying their own copy of this
// list, which is how /aero-rig ended up in one and not the other. It is
// also what the grouping below fixes: fifteen routes in a single flat
// row overflowed 1280px, so the last five were reachable only by
// scrolling a bar that gave no sign there was anything to scroll to.
//
// `line` is the one-sentence description of what the page does. It is
// shown in the nav menu and on the home page, so a link says what it
// leads to before it is clicked.

export const GROUPS = [
  {
    id: 'season',
    name: 'Season',
    items: [
      { to: '/ledger', name: 'Season Ledger', line: 'The championship, accumulated independently and cross-checked against the published table.' },
      { to: '/qualifying', name: 'Qualifying', line: 'Team-mate head to head — the one comparison where the car is held constant.' },
      { to: '/sprint', name: 'Sprint Weekends', line: 'Two races, one circuit, two grids, a day apart — and how far the orders agreed.' },
      { to: '/upcoming', name: 'Upcoming', line: 'Priors from past editions of the next circuit, each with the sample behind it.' },
    ],
  },
  {
    id: 'race',
    name: 'Race',
    items: [
      { to: '/strategy', name: 'Race Strategy', line: 'Stints by real compound, an undercut ledger, and per-stint pace fits with their R².' },
      { to: '/lines', name: 'Racing Lines', line: 'Driven laps overlaid, colourable by any published channel, with a mini-sector dominance map.' },
      { to: '/style', name: 'Driving Style', line: 'How a lap was driven rather than how quick it was. There is no better column.' },
      { to: '/errors', name: 'Error Review', line: 'What race control recorded, kept strictly apart from what this site merely noticed.' },
      { to: '/radio', name: 'Team Radio', line: 'Who the broadcast put on air, on which lap — linked, never transcribed.' },
    ],
  },
  {
    id: 'car',
    name: 'Car & Track',
    short: 'Car',
    items: [
      { to: '/circuits', name: 'Circuit Atlas', line: 'Outlines traced from real laps, with detected turns, gear, braking point and elevation.' },
      { to: '/aero', name: 'Aero Explainer', line: 'Cornering load computed from the driven line: a g-g diagram and grip against speed.' },
      { to: '/aero-rig', name: 'Aero Rig', line: 'The 2026 car in 3D, wearing a downforce signature measured from real laps.' },
    ],
  },
  {
    id: 'lab',
    name: 'Lab',
    items: [
      { to: '/whatif', name: 'What-If Engine', line: 'Replay a race on a different strategy — only where the model reproduces the real one.' },
      { to: '/refusals', name: 'Refusals', line: 'Everything computed and then withheld, with the number that made the decision.' },
    ],
  },
];

export const MODULES = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.name })));

/** The group a path belongs to, so the nav can mark where you are. */
export function groupOf(pathname) {
  return GROUPS.find((g) => g.items.some((i) => i.to === pathname))?.id ?? null;
}
