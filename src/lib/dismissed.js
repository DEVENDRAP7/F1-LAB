/* Which flagged laps a reader has put away.
 *
 * SPEC ground rule 4: "Mistake detection is a flag, not an accusation,
 * and links to the triggering telemetry. Flags are dismissable." The
 * first two halves shipped and this one did not.
 *
 * Two things are deliberate about the shape.
 *
 * Only a FLAGGED lap can be dismissed. The Error Review holds two kinds
 * of row and the page's whole argument is that they are different: a
 * RECORDED row is a race-control message, published by someone else and
 * quoted here, and a reader dismissing it would be editing the record.
 * A FLAGGED row is this project's own observation that a lap ran slower
 * than the same driver's median — an opinion, offered with its
 * threshold, and an opinion is exactly the thing a reader is entitled to
 * wave off. So dismissal is keyed to flagged laps and there is no code
 * path here that can reach a recorded one.
 *
 * And it is a reader's own note, not part of the page's address. Round
 * and driver live in the URL because they are what the page is showing;
 * a dismissal is not — a shared link should land on the same race, not
 * carry which flags the sharer had stopped caring about. So it goes to
 * localStorage, which also means it survives a reload, and never to the
 * query string.
 *
 * Every read and write is wrapped: a private window, blocked site data,
 * or a full quota all throw here, and a reader who cannot save a
 * dismissal should still get a working page with nothing dismissed
 * rather than a blank one. */

const KEY = 'apexlab.dismissedFlags.v1';

/** One flagged lap's stable identity: the race, the driver, the lap. */
export function flagKey(round, driver, lap) {
  return `${round}:${driver}:${lap}`;
}

export function load(storage = safeStorage()) {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    // Anything but an array of strings is somebody else's data or a
    // half-written value, and is discarded rather than trusted.
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k) => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

export function save(keys, storage = safeStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify([...keys]));
    return true;
  } catch {
    // Out of quota or a storage-blocked context. The dismissal still
    // applies for this visit; it just will not outlive it.
    return false;
  }
}

export function dismiss(keys, key) {
  const next = new Set(keys);
  next.add(key);
  return next;
}

export function restore(keys, key) {
  const next = new Set(keys);
  next.delete(key);
  return next;
}

/** Clear only this round and driver, leaving other races alone. */
export function restoreAll(keys, round, driver) {
  const prefix = `${round}:${driver}:`;
  const next = new Set();
  for (const key of keys) if (!key.startsWith(prefix)) next.add(key);
  return next;
}

/** Split flagged laps into what is showing and what has been put away. */
export function partition(flagged, keys, round, driver) {
  const showing = [];
  const hidden = [];
  for (const lap of flagged) {
    const target = keys.has(flagKey(round, driver, lap.lap)) ? hidden : showing;
    target.push(lap);
  }
  return { showing, hidden };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return null;
  }
}
