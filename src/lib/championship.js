// Whether the drivers' title is already settled, from the Ledger's own
// elimination arithmetic and nothing else.
//
// public/data/standings.json carries, for every driver, whether they are
// "eliminated": taking every remaining point still leaves them behind the
// leader's CURRENT total, so not even a leader who never scores again
// could be caught. The leader is never eliminated — their own maximum is
// at least their own total — which means that when every other driver is
// eliminated there is exactly one driver who can still win it, and it is
// the one in front. That is the title decided, by the same bound the page
// already used to grey out each driver.
//
// This is deliberately not a prediction and not a reading of the news. It
// is the existing elimination bound, counted, and it inherits that
// bound's strictness: a driver who could merely draw level is NOT
// eliminated (the tie breaks on countback, which depends on results that
// have not happened), so a tie on the bound can never read as decided.
//
// Returns false once no rounds remain. Then there is nothing left to
// decide — the table is final, and the leader is simply the champion —
// and the note this feeds is not shown at all.

/**
 * @param {number} driverCount  how many drivers are in the standings
 * @param {{remainingRounds?: number, drivers?: Record<string, {eliminated?: boolean}>}|null|undefined} elimination
 * @returns {boolean}
 */
export function titleDecided(driverCount, elimination) {
  if (!elimination || !elimination.drivers) return false;
  if (!(elimination.remainingRounds > 0)) return false;
  if (!(driverCount > 1)) return false;
  const eliminated = Object.values(elimination.drivers).filter((d) => d?.eliminated).length;
  return eliminated === driverCount - 1;
}
