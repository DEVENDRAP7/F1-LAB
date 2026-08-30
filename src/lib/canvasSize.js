// Whether a WebGL canvas's backing store still matches its CSS size.
//
// This is one line of arithmetic and it had a bug in it that disabled
// zoom for a large share of readers, so it lives here with a test rather
// than inline in the render loop.
//
// The trap: WebGLRenderer.setSize FLOORS the backing-store size —
// canvas.width = Math.floor(cssWidth * pixelRatio). Comparing the stored
// integer against the unfloored product is therefore true forever at any
// fractional device pixel ratio. 1.25 is not an exotic value; it is what
// Windows display scaling at 125% reports, and plenty of phones report
// something similar.
//
// The cost was not a stutter. The resize branch re-frames the camera, so
// the whole scene was being re-fitted sixty times a second and any zoom
// the reader asked for was overwritten before the next frame drew.
// Measured against the built page: scrolling to zoom moved the car 2.16x
// at ratio 1 and 1.00x — nothing at all — at ratio 1.25.
export function needsResize(canvasWidth, canvasHeight, cssWidth, cssHeight, pixelRatio) {
  return canvasWidth !== Math.floor(cssWidth * pixelRatio)
    || canvasHeight !== Math.floor(cssHeight * pixelRatio);
}
