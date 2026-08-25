// Lap and sector times in the form the sport actually uses.
//
// A lap is quoted as M:SS.mmm once it passes a minute — 103.174 seconds
// is "1:43.174", never "103.174s". Raw seconds past sixty is a number
// nobody in F1 reads, and on a page full of lap times it forces the
// reader to do the division themselves on every row.
//
// Under a minute the seconds form is correct and is what timing screens
// show, so a 59.812 stays 59.812 rather than becoming 0:59.812.

const MILLIS_DP = 3;

function pad(value, width) {
  return String(value).padStart(width, '0');
}

/** A lap/sector time. M:SS.mmm at or past a minute, SS.mmm below it. */
export function formatLapTime(seconds, { decimals = MILLIS_DP } = {}) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const negative = seconds < 0;
  const total = Math.abs(seconds);

  if (total < 60) {
    return `${negative ? '-' : ''}${total.toFixed(decimals)}`;
  }

  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  // Guard the carry: 119.9996 must render 2:00.000, not 1:60.000.
  const restText = rest.toFixed(decimals);
  if (parseFloat(restText) >= 60) {
    return `${negative ? '-' : ''}${minutes + 1}:${pad((0).toFixed(decimals), decimals + 3)}`;
  }
  return `${negative ? '-' : ''}${minutes}:${pad(restText, decimals + 3)}`;
}

/**
 * A gap or delta. Signed, and in seconds while it stays under a minute —
 * which is how gaps are quoted — but a delta big enough to pass a minute
 * gets the same M:SS.mmm treatment rather than running to three digits.
 */
export function formatDelta(seconds, { decimals = MILLIS_DP, sign = true } = {}) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const prefix = sign && seconds > 0 ? '+' : '';
  return `${prefix}${formatLapTime(seconds, { decimals })}`;
}

/** A duration with no sub-second meaning (pit-stop time, session length). */
export function formatDuration(seconds, { decimals = 1 } = {}) {
  return formatLapTime(seconds, { decimals });
}
