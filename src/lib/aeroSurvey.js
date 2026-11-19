// What the published aero laps say, taken together.
//
// The Aero Explainer makes two claims about the whole season rather than
// about the lap on screen: that the median lap sits some percent off the
// corner model, and that coasting — off both pedals, above a speed floor,
// going roughly straight — is rare enough that the drag fit cannot be
// published. Both used to be sentences with the numbers typed into them.
// Typed numbers describe the data as it was on the day somebody typed
// them, and this data gains a round every week: the sentence said 88 laps
// when there were 152, one coasting sample when the median was two, and 38
// laps with none when it was 62.
//
// So the page reads the per-lap values the exporter wrote and this
// function does the arithmetic. Medians, not means: one lap with a
// freak corner should not move a claim about "the median lap".

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {Array<{coastSamples?: number|null, cornerModelErrorPct?: number|null}>} laps
 *   The `laps` array of public/data/2026/aero.json.
 * @returns {{
 *   laps: number,
 *   modelLaps: number, medianModelErrorPct: number|null,
 *   coastLaps: number, medianCoastSamples: number|null, lapsWithoutCoast: number,
 * }} Each claim carries its own sample size, because a lap that has no value
 *   for one of the two is left out of that claim only, and the sentence has
 *   to be able to say how many laps it is actually about.
 */
export function seasonSurvey(laps) {
  const list = Array.isArray(laps) ? laps : [];
  const errors = list.map((l) => l?.cornerModelErrorPct).filter(isNumber);
  const coast = list.map((l) => l?.coastSamples).filter(isNumber);
  return {
    laps: list.length,
    modelLaps: errors.length,
    medianModelErrorPct: median(errors),
    coastLaps: coast.length,
    medianCoastSamples: median(coast),
    lapsWithoutCoast: coast.filter((c) => c === 0).length,
  };
}
