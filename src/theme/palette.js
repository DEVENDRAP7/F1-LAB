// Canvas can't consume CSS custom properties directly, so this is the one
// sanctioned bridge from tokens.css into imperative drawing code. Colours
// are still defined only in tokens.css — this file reads them, it never
// declares its own.

const FALLBACKS = {
  '--series-1': '#3b8ef0',
  '--series-2': '#d4711a',
  '--series-3': '#1f9d9d',
  '--series-4': '#b845c4',
  '--ink-0': '#e8eaee',
  '--ink-1': '#9aa2b1',
  '--ink-2': '#5c6474',
  '--line': '#262b35',
  '--bg-1': '#12151b',
  '--bg-2': '#1a1e26',
};

export function cssToken(name) {
  if (typeof document !== 'undefined') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) return value;
  }
  return FALLBACKS[name] ?? '#888888';
}

// Series colours are assigned by position in the selection and never
// cycled — selection is capped at MAX_SERIES so a 5th hue is never
// invented. Colour follows the entity: callers key the slot to the
// driver, not to their rank, so filtering others out never repaints
// the ones that remain.
export const MAX_SERIES = 4;

export function seriesColor(slot) {
  return cssToken(`--series-${Math.min(slot, MAX_SERIES - 1) + 1}`);
}
