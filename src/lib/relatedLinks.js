// The catalogue behind the "same weekend, other questions" footer. Each entry
// says what a page answers and which parts of the current selection it can
// actually use — /strategy has no session concept, /circuits is keyed by
// circuit rather than round — so a link never carries a parameter its target
// would ignore, and never drops one it would have used.

export const DESTINATIONS = {
  '/strategy': {
    label: 'Race Strategy',
    note: 'Stints, pit stops, and the measured pace trend through each one.',
    carries: ['round'],
  },
  '/qualifying': {
    label: 'Qualifying',
    note: 'The grid as it was set, and the team-mate gap behind it.',
    carries: ['round'],
  },
  '/sprint': {
    label: 'Sprint Weekends',
    note: 'Both races of the weekend, and how far the two orders agreed.',
    carries: ['round'],
  },
  '/lines': {
    label: 'Racing Lines',
    note: 'Two fastest laps overlaid metre by metre, with the delta between them.',
    carries: ['round', 'session'],
  },
  '/style': {
    label: 'Driving Style',
    note: 'How the lap was driven: throttle, coasting, corner minimums, pickup.',
    carries: ['round', 'session'],
  },
  '/aero': {
    label: 'Aero',
    note: 'Cornering load from a curvature fit, with the working shown.',
    carries: ['round', 'session'],
  },
  '/circuits': {
    label: 'Circuit Atlas',
    note: 'The measured outline, elevation, and turn-by-turn table.',
    carries: ['circuit'],
  },
  '/errors': {
    label: 'Error Review',
    note: 'Laps that ran slow, flagged with the track state at the time.',
    carries: ['round'],
  },
  '/whatif': {
    label: 'What-If',
    note: 'What the fitted model estimates a different strategy would have done.',
    carries: ['round'],
  },
};

export function relatedLinks(paths, context = {}) {
  return paths
    .filter((path) => DESTINATIONS[path])
    .map((path) => {
      const destination = DESTINATIONS[path];
      const params = {};
      for (const key of destination.carries) {
        const value = context[key];
        if (value !== '' && value !== null && value !== undefined) params[key] = value;
      }
      return { to: path, label: destination.label, note: destination.note, params };
    });
}

// The circuit id for a round, so a link to the Atlas lands on the right track.
// The calendar is the only place that mapping exists on the client; guessing it
// from a race name would be the same mistake as numbering corners from memory.
export function circuitForRound(calendar, round) {
  if (!calendar || !round) return '';
  const match = calendar.find((r) => String(r.round) === String(round));
  return match?.circuitId ?? '';
}

// The other direction, for the Atlas, which is selected by circuit. A circuit
// can appear more than once on a calendar, so this takes the latest round at
// it — the one whose data is most likely to be exported.
export function roundForCircuit(calendar, circuitId) {
  if (!calendar || !circuitId) return '';
  const matches = calendar.filter((r) => r.circuitId === circuitId);
  if (matches.length === 0) return '';
  return matches[matches.length - 1].round;
}

// Only sprint rounds have a sprint weekend to link to. Offering the link
// on every round would land two thirds of them on whatever sprint the
// page defaults to, which is the failure these links exist to avoid.
export function isSprintRound(calendar, round) {
  if (!calendar || !round) return false;
  const match = calendar.find((r) => String(r.round) === String(round));
  return Boolean(match?.sprint);
}
