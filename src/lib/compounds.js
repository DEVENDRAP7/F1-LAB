// The sport's compound bands, in one place.
//
// These were defined inside StintChart while it was the only thing that
// drew a compound. The what-if editor needs the same swatches, and two
// copies of a colour map is how a soft tyre ends up red on one page and
// orange on another.
//
// Hard is a light neutral rather than pure white so it still reads as a
// band on a light surface; intermediate and wet are here even though a
// dry race never shows them, because a wet race must not fall back to an
// ordinal ramp for want of a colour.
export const COMPOUND_FILL = {
  SOFT: 'var(--compound-soft)',
  MEDIUM: 'var(--compound-medium)',
  HARD: 'var(--compound-hard)',
  INTERMEDIATE: 'var(--compound-inter)',
  WET: 'var(--compound-wet)',
};

// Ink chosen per band against that band, so a label clears 4.5:1 on every
// one rather than being legible on some and grey mush on others.
export const COMPOUND_INK = {
  SOFT: '#ffffff',
  MEDIUM: '#141414',
  HARD: '#141414',
  INTERMEDIATE: '#0d0d0d',
  WET: '#ffffff',
};

// Softest to hardest, then the wets: the order a strategist reads them in.
export const COMPOUND_ORDER = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

/** The band name if it is one this project knows, otherwise null. */
export function normaliseCompound(value) {
  const c = (value || '').toUpperCase();
  return c in COMPOUND_FILL ? c : null;
}

/** Fill for a compound, or a neutral surface when it is not a known band. */
export function compoundSwatch(value) {
  const c = normaliseCompound(value);
  return c ? COMPOUND_FILL[c] : 'var(--line)';
}
