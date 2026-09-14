import { dataPath } from './dataPath.js';

/* The two documents more than one component needs, fetched once.
 *
 * season.json and telemetry.json are the site's two indexes: what the
 * calendar says, and what the pipeline has actually produced. Several
 * views need one or both to decide what to offer before they ask for any
 * of it.
 *
 * They were fetched with a bare fetch() wherever they were wanted, and
 * once the landing page had two components that both wanted them the
 * network log showed each document requested twice, in parallel — early
 * enough that the HTTP cache had nothing to serve the second request
 * from. Measured on the landing page: two duplicate requests out of
 * twenty-four.
 *
 * So the promise is cached, not the response: a second caller that
 * arrives while the first request is still in flight gets the same
 * promise rather than starting another. A failure is not cached — it is
 * dropped, so a reader whose connection dropped for a moment can get the
 * document on the next attempt rather than being stuck with the error
 * for the life of the page.
 */

const inFlight = new Map();

function once(key, fetcher) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = fetcher().catch((error) => {
    inFlight.delete(key);
    throw error;
  });
  inFlight.set(key, promise);
  return promise;
}

async function getJson(path) {
  const res = await fetch(dataPath(path));
  if (!res.ok) throw new Error(`${path} unavailable: HTTP ${res.status}`);
  return res.json();
}

/** The calendar and entry list. */
export function loadSeason() {
  return once('season', () => getJson('season.json'));
}

/** What the telemetry backfill has produced — see telemetryIndex.js. */
export function loadTelemetry(year = 2026) {
  return once(`telemetry:${year}`, () => getJson(`${year}/telemetry.json`));
}

/** Test seam: forget what has been fetched. */
export function resetPublishedCache() {
  inFlight.clear();
}
