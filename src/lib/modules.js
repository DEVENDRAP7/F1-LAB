// The site's map, in one place.
//
// The nav and the home page were each carrying their own copy of this
// list, which is how the Aero Rig ended up in one and not the other. It
// is also what the grouping below fixes: fifteen routes in a single flat
// row overflowed 1280px, so the last five were reachable only by
// scrolling a bar that gave no sign there was anything to scroll to.
//
// Grouping fixed the overflow without fixing the count. Six of those
// entries were three pairs, each pair asking for the same round, session
// and driver before answering two halves of one question, so each pair
// is now one entry with a tab strip — see components/ViewTabs.jsx. Eleven
// entries, and nothing dropped.
//
// `line` is the one-sentence description of what the page does. It is
// shown in the nav menu and on the home page, so a link says what it
// leads to before it is clicked.
//
// `views` are the tabs of a merged page, in the order they are shown;
// the first is the one the page opens on and the one whose key is left
// out of the URL. They live here rather than in the page file so that
// the redirects below, and a test, can check that every old path still
// names a view that exists.

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
      {
        to: '/lines',
        name: 'Driven Laps',
        line: 'Laps overlaid metre by metre, and how each one was driven. No better column.',
        views: [
          {
            key: 'lines',
            name: 'Racing lines',
            line: "Two drivers' fastest laps laid over each other, metre by metre.",
          },
          {
            key: 'style',
            name: 'Driving style',
            line: 'How those laps were driven rather than how quick they were. There is no better column.',
          },
        ],
      },
      {
        to: '/record',
        name: 'Race Record',
        line: 'What race control recorded, and who the broadcast put on air — neither one a verdict.',
        views: [
          {
            key: 'incidents',
            name: 'Incidents',
            line: "What race control recorded, and which laps ran slower than a driver's own pace.",
          },
          {
            key: 'radio',
            name: 'Team radio',
            line: 'Who the broadcast put on air, on which lap — linked, never transcribed.',
          },
        ],
      },
    ],
  },
  {
    id: 'car',
    name: 'Car & Track',
    short: 'Car',
    items: [
      { to: '/circuits', name: 'Circuit Atlas', line: 'Outlines traced from real laps, with detected turns, gear, braking point and elevation.' },
      {
        to: '/aero',
        name: 'Aerodynamics',
        line: 'Cornering load computed from the driven line, and the 3D car those numbers act on.',
        views: [
          {
            key: 'measured',
            name: 'Measured',
            line: 'Acceleration the car sustained, and at what speed, measured from the driven line.',
          },
          {
            key: 'rig',
            name: 'The car',
            line: 'The same numbers around a 3D car, with every part labelled by what is actually known about it.',
          },
        ],
      },
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

/* Where a path that used to be its own page goes now.
 *
 * Six pages became three. A link that has been shared, bookmarked or
 * written down is not this project's to break, so every one of the old
 * paths is still a live route that lands on the view it used to be —
 * see the redirects in App.jsx, which read this table. */
export const LEGACY_PATHS = {
  '/style': { to: '/lines', view: 'style' },
  '/aero-rig': { to: '/aero', view: 'rig' },
  // No view: /errors was what /record now opens on, and a redirect that
  // wrote view=incidents into the URL would be stating a default, which
  // is the one thing the query string here never does.
  '/errors': { to: '/record' },
  '/radio': { to: '/record', view: 'radio' },
};

/** The tabs of a merged page, for the page itself to render. */
export function viewsOf(path) {
  return MODULES.find((m) => m.to === path)?.views ?? [];
}

/** The group a path belongs to, so the nav can mark where you are. */
export function groupOf(pathname) {
  return GROUPS.find((g) => g.items.some((i) => i.to === pathname))?.id ?? null;
}
