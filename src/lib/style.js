import { detectTurns } from './corners.js';

// Driving style, which is a different question from lap time.
//
// Every dashboard ranks drivers by how fast they went. This describes how
// they got there: how much of the lap they spend at full throttle, how
// much on the brakes, how much doing neither, how early the throttle
// comes back after a corner, and how much speed they carry through one.
// Two drivers a tenth apart can reach that tenth in opposite ways, and
// the lap time does not say which.
//
// Every figure comes from a channel the source publishes — throttle as a
// percentage, brake as on or off, gear as a whole number, speed in km/h —
// resampled onto the same 2 m grid as the line. Nothing here is fitted
// or modelled except the turn detection, which is stated where it is
// used.
//
// WHAT THIS IS NOT
// Not a ranking. There is no "better" column: carrying more speed into a
// corner is not superior to braking later and turning tighter, they are
// different ways round the same piece of track, and which one is quicker
// depends on the corner, the car and the tyre.
// Not a full picture either. There is no steering channel here, so
// nothing about hands; no throttle trace between 0 and 100 finer than a
// percent; and it is one lap, on that lap's fuel and tyre.

const FULL_THROTTLE_PCT = 98;
const IDLE_THROTTLE_PCT = 5;
// How far past a corner's apex to look for the throttle coming back. A
// corner whose exit runs into the next braking zone never reaches full
// throttle, and that is a real answer rather than a missing one — it is
// left out of the mean and counted.
const PICKUP_WINDOW_M = 600;

function share(values, predicate) {
  if (!values || values.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < values.length; i += 1) if (predicate(i)) hits += 1;
  return hits / values.length;
}

/**
 * One driver's style on one lap.
 *
 * `channels` are the decoded, unscaled arrays; `trace` is aero's
 * acceleration trace, used only to find the corners.
 */
export function drivingStyle(channels, trace, ds = 2) {
  const { throttle, brake, gear, speed } = channels;
  const n = Math.min(throttle?.length ?? 0, brake?.length ?? 0);
  if (n === 0) return null;

  const turns = detectTurns(trace, ds);

  let gearChanges = 0;
  for (let i = 1; i < (gear?.length ?? 0); i += 1) {
    if (gear[i] !== gear[i - 1]) gearChanges += 1;
  }

  // How far past the apex the throttle reaches full, averaged over the
  // corners where it does at all.
  const pickups = [];
  const windowSamples = Math.round(PICKUP_WINDOW_M / ds);
  for (const turn of turns) {
    for (let step = 0; step < windowSamples; step += 1) {
      const i = (turn.apexIndex + step) % n;
      if (throttle[i] >= FULL_THROTTLE_PCT) {
        pickups.push(step * ds);
        break;
      }
    }
  }

  const cornerMinima = turns.map((turn) => turn.minSpeedKph);

  return {
    lapDistanceM: n * ds,
    fullThrottleShare: share(throttle, (i) => throttle[i] >= FULL_THROTTLE_PCT),
    brakingShare: share(brake, (i) => brake[i] > 0),
    // Neither pedal: the part of a lap a driver is carrying speed rather
    // than adding or shedding it.
    coastingShare: share(brake, (i) => brake[i] === 0 && throttle[i] <= IDLE_THROTTLE_PCT),
    gearChanges,
    turns: turns.length,
    meanCornerMinimumKph: cornerMinima.length
      ? cornerMinima.reduce((a, b) => a + b, 0) / cornerMinima.length
      : null,
    // Metres from the apex to full throttle, and how many corners that
    // average is made of — a corner that never reaches full throttle
    // before the next braking zone is excluded rather than counted as
    // the window length.
    meanThrottlePickupM: pickups.length
      ? pickups.reduce((a, b) => a + b, 0) / pickups.length
      : null,
    pickupsCounted: pickups.length,
    topSpeedKph: speed ? Math.max(...speed) : null,
  };
}

// The metrics a comparison shows, in the order they read best: what the
// driver was doing with the pedals, then what that produced.
export const STYLE_METRICS = [
  {
    key: 'fullThrottleShare',
    label: 'Full throttle',
    format: (v) => `${(v * 100).toFixed(1)}%`,
    note: 'share of the lap at 98% throttle or more',
  },
  {
    key: 'brakingShare',
    label: 'On the brakes',
    format: (v) => `${(v * 100).toFixed(1)}%`,
    note: 'share of the lap with the brake applied',
  },
  {
    key: 'coastingShare',
    label: 'Coasting',
    format: (v) => `${(v * 100).toFixed(1)}%`,
    note: 'neither pedal: carrying speed rather than adding or shedding it',
  },
  {
    key: 'meanThrottlePickupM',
    label: 'Throttle after the apex',
    format: (v) => (v == null ? '—' : `${Math.round(v)} m`),
    note: 'mean distance from a corner apex to full throttle',
  },
  {
    key: 'meanCornerMinimumKph',
    label: 'Mean corner minimum',
    format: (v) => (v == null ? '—' : `${Math.round(v)} km/h`),
    note: 'average of the slowest point of each detected turn',
  },
  {
    key: 'gearChanges',
    label: 'Gear changes',
    format: (v) => String(v),
    note: 'shifts in both directions across the lap',
  },
];
