// Pinch-to-zoom arithmetic, kept apart from the scene so it can be
// tested without standing up a WebGL context.
//
// The gesture is anchored: the radius is computed from where the fingers
// STARTED, not accumulated frame by frame. Accumulating drifts — a pinch
// out and back in does not return to where it began — and the drift is
// worst exactly when someone is fiddling to frame something.

/** Distance between two points, for a two-finger spread. */
export function spread(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The camera radius for a pinch, clamped to the zoom limits.
 *
 *  Fingers apart (dist > startDist) means zoom IN, which is a SMALLER
 *  radius — hence the inverse ratio. */
export function pinchRadius(startRadius, startDist, dist, min, max) {
  if (!(startDist > 0) || !(dist > 0)) return startRadius;
  return Math.max(min, Math.min(max, startRadius * (startDist / dist)));
}
