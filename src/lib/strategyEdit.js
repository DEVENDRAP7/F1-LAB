// Editing a strategy without changing the race.
//
// The one invariant every edit here preserves is the race distance: a
// strategy that covers 47 laps of a 44-lap race is not a counterfactual,
// it is a different event. Adding a stop splits an existing stint and
// removing one gives its laps to a neighbour, so the total never moves
// and the reader never has to repair an arithmetic error the UI made.

/** Laps a strategy covers. */
export function lapsCovered(strategy) {
  return strategy.reduce((sum, stint) => sum + stint.laps, 0);
}

/**
 * Add a stop by splitting the longest stint in two.
 *
 * The longest stint is the one with room to divide, and splitting it puts
 * the new stop somewhere a strategist might actually have called it
 * rather than on lap 1. A stint of one lap cannot be split, so a strategy
 * with no divisible stint is returned unchanged.
 */
export function addStop(strategy) {
  if (strategy.length === 0) return strategy;
  let longest = 0;
  strategy.forEach((stint, i) => {
    if (stint.laps > strategy[longest].laps) longest = i;
  });
  const first = Math.floor(strategy[longest].laps / 2);
  const second = strategy[longest].laps - first;
  if (first < 1 || second < 1) return strategy;

  const next = [...strategy];
  next.splice(
    longest,
    1,
    { ...strategy[longest], laps: first },
    { ...strategy[longest], laps: second },
  );
  return next;
}

/**
 * Remove a stint, giving its laps to the one that follows it — or to the
 * one before, when the last stint is the one removed. The laps have to go
 * somewhere: dropping them would quietly shorten the race.
 */
export function removeStint(strategy, index) {
  if (strategy.length <= 1) return strategy;
  if (index < 0 || index >= strategy.length) return strategy;

  const next = [...strategy];
  const [dropped] = next.splice(index, 1);
  const absorb = Math.min(index, next.length - 1);
  next[absorb] = { ...next[absorb], laps: next[absorb].laps + dropped.laps };
  return next;
}

/** Set one stint's lap count, never below a single lap. */
export function setLaps(strategy, index, laps) {
  return strategy.map((stint, i) =>
    (i === index ? { ...stint, laps: Math.max(1, Math.floor(laps) || 1) } : stint));
}

/** Set one stint's compound. */
export function setCompound(strategy, index, compound) {
  return strategy.map((stint, i) => (i === index ? { ...stint, compound } : stint));
}
