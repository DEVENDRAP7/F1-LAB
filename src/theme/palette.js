// Canvas can't consume CSS custom properties directly, so this is the one
// sanctioned bridge from tokens.css into imperative drawing code. Colours
// are still defined only in tokens.css — this file reads them, it never
// declares its own.

const FALLBACKS = {
  '--driver-1': '#3b8ef0',
  '--driver-2': '#e8842f',
  '--driver-3': '#2fbfbf',
  '--driver-4': '#d75fd7',
  '--ink-1': '#9aa2b1',
  '--ink-2': '#5c6474',
  '--line': '#262b35',
};

export function cssToken(name) {
  if (typeof document !== 'undefined') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) return value;
  }
  return FALLBACKS[name] ?? '#888888';
}

export function driverColor(slot) {
  return cssToken(`--driver-${(slot % 4) + 1}`);
}
