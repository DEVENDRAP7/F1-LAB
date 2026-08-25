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

/**
 * A duration: a pit stop, a session, or a whole race.
 *
 * Past an hour it carries the hour, because a race distance quoted as
 * "100:14.9" reads as a hundred-minute lap. Under an hour it falls
 * through to the lap form, which is what a pit stop or a stint wants.
 */
export function formatDuration(seconds, { decimals = 1 } = {}) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const negative = seconds < 0;
  const total = Math.abs(seconds);
  if (total < 3600) return formatLapTime(seconds, { decimals });

  const hours = Math.floor(total / 3600);
  const rest = total - hours * 3600;
  const restText = formatLapTime(rest < 60 ? rest + 60 : rest, { decimals });
  // formatLapTime drops the leading zero on a minute, and an hour needs
  // it: 1:2:03.4 is not a time anyone writes.
  const [minutes, secondsText] = restText.split(':');
  const carried = Number(minutes) - (rest < 60 ? 1 : 0);
  if (carried >= 60) {
    return `${negative ? '-' : ''}${hours + 1}:00:${secondsText}`;
  }
  return `${negative ? '-' : ''}${hours}:${pad(carried, 2)}:${secondsText}`;
}
