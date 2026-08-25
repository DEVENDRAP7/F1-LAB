// Driver identity comes from the entry list, never from the id string.
//
// The strategy board derived a code with `driverId.slice(0, 3)`, which
// produced MAX for Verstappen and ARV for Lindblad — abbreviations that
// look official and are not. The real codes are published in
// season.json's entry list, so the only correct move is to look them up
// and to say plainly when a lookup misses rather than invent a fallback
// that reads like a real code.

/** driverId -> { code, name } from the season entry list. */
export function driverIndex(entryList = []) {
  const index = new Map();
  for (const d of entryList) {
    if (!d?.driverId) continue;
    index.set(d.driverId, {
      code: d.code || null,
      name: [d.givenName, d.familyName].filter(Boolean).join(' ') || d.driverId,
    });
  }
  return index;
}

/**
 * The published three-letter code. Falls back to the id in a readable
 * form — never to a truncation, which would be indistinguishable from a
 * real code while being wrong.
 */
export function driverCode(index, driverId) {
  return index.get(driverId)?.code ?? prettyId(driverId);
}

export function driverName(index, driverId) {
  return index.get(driverId)?.name ?? prettyId(driverId);
}

/** "max_verstappen" -> "Max Verstappen", for ids with no entry. */
export function prettyId(driverId) {
  if (!driverId) return '—';
  return String(driverId)
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
