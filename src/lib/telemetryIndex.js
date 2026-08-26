import { dataPath } from './dataPath.js';

// What the telemetry backfill has actually produced, in one fetch.
//
// The pages used to probe for it: ask for a round's manifest, catch the
// 404, try the round before, and repeat per session. It worked, and it
// filled the console with failures that look like bugs while asking the
// network for files nobody expected to exist. The pipeline writes the
// listing now, so the site knows what it has before it asks for any of
// it.

export async function loadTelemetryIndex(year = 2026) {
  const res = await fetch(dataPath(`${year}/telemetry.json`));
  if (!res.ok) throw new Error(`telemetry index unavailable: HTTP ${res.status}`);
  return res.json();
}

/** Sessions with real lines for a round, in the caller's order of preference. */
export function sessionsWithLines(index, round, preference = ['Q', 'R']) {
  const entry = index?.rounds?.[String(round)] ?? {};
  return preference.filter((key) => (entry[key]?.drivers?.length ?? 0) > 0);
}

/**
 * The newest round that has a line, and which session it is on.
 *
 * `rounds` is the calendar order the caller wants searched (newest
 * first). A session marked unavailable is not a candidate: it exists
 * precisely to say there is nothing in it.
 */
export function newestRoundWithLines(index, rounds, preference = ['Q', 'R']) {
  for (const key of preference) {
    for (const round of rounds) {
      if (sessionsWithLines(index, round, [key]).length > 0) {
        return { round: String(round), session: key };
      }
    }
  }
  return null;
}

/** Why a round/session has no lines, when the pipeline recorded a reason. */
export function isUnavailable(index, round, session) {
  return Boolean(index?.rounds?.[String(round)]?.[session]?.unavailable);
}
