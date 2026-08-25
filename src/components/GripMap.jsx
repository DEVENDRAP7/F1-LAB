import { useEffect, useMemo, useRef, useState } from 'react';
import { cssToken } from '../theme/palette.js';

// The driven line, coloured by how much lateral acceleration the car was
// carrying at each point of it — the braking zones, the corners and the
// straights fall out of the colour without anyone labelling them.
//
// Magnitude, so a sequential ramp: one hue, low to high, five steps.
// Colour is not the only channel — the bands are labelled with their g
// values in the legend, and hovering reads out the exact figure with the
// speed it was carried at, so a reader who cannot separate two steps can
// still get the number.
//
// Banded rather than continuous on purpose. A continuous gradient invites
// reading a precision off the colour that a fitted curvature does not
// have; five bands say "about this much", which is what the measurement
// supports.

// Whole g, with the top band open-ended. Fixed thresholds rather than
// fifths of this lap's peak: a band that means "a fifth of whatever the
// fastest sample was" changes meaning between drivers and circuits, and
// on real data it also collapsed — four fifths of the lap fell in the
// bottom two bands and the map came out a single colour. Whole g is a
// unit a reader already holds, and the split is close to even.
const BAND_EDGES = [1, 2, 3, 4];
const BANDS = BAND_EDGES.length + 1;
const PAD = 26;

// Colour is smoothed over this many samples either side (about 20 m of
// track) before it is banded. Per-sample lateral g flips across a band
// edge several times through one corner — the underlying fit is per
// sample and a corner is not perfectly even — and the map came out
// speckled, which reads as noise rather than as a corner. The smoothing
// is for the colour only: every number on this page still comes from the
// unsmoothed trace.
const COLOUR_SMOOTHING = 5;

function smoothMagnitude(values, half) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -half; k <= half; k += 1) {
      // The lap closes, so the window wraps rather than truncating.
      const v = values[(i + k + n) % n];
      if (Number.isFinite(v)) {
        sum += Math.abs(v);
        count += 1;
      }
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function bandFor(value) {
  if (!Number.isFinite(value)) return 0;
  const g = Math.abs(value);
  let band = 0;
  while (band < BAND_EDGES.length && g >= BAND_EDGES[band]) band += 1;
  return band;
}

export default function GripMap({ points, lateralG, speedKph, turns = [], highlight = null, height = 420 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => {
    if (!points || points.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
  }, [points]);

  const size = Math.min(width, height);

  const project = useMemo(() => {
    if (!bounds) return null;
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanY = bounds.maxY - bounds.minY || 1;
    const scale = Math.min((size - PAD * 2) / spanX, (size - PAD * 2) / spanY);
    // Centred rather than corner-anchored, so a circuit that is much
    // wider than it is tall does not sit against one edge.
    const offsetX = (size - spanX * scale) / 2;
    const offsetY = (size - spanY * scale) / 2;
    return ([x, y]) => [
      offsetX + (x - bounds.minX) * scale,
      // Screen y grows downward; the position frame does not.
      size - offsetY - (y - bounds.minY) * scale,
    ];
  }, [bounds, size]);

  const shaded = useMemo(
    () => smoothMagnitude(lateralG, COLOUR_SMOOTHING),
    [lateralG],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project || !points || points.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const colors = Array.from({ length: BANDS }, (_, i) => cssToken(`--grip-${i + 1}`));
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // One stroke per band rather than per segment: a stroke call for each
    // of a couple of thousand points is what makes a canvas map crawl.
    for (let band = 0; band < BANDS; band += 1) {
      ctx.strokeStyle = colors[band];
      ctx.beginPath();
      let open = false;
      for (let i = 1; i < points.length; i += 1) {
        if (bandFor(shaded[i]) !== band) {
          open = false;
          continue;
        }
        const [x0, y0] = project(points[i - 1]);
        const [x1, y1] = project(points[i]);
        if (!open) ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        open = true;
      }
      ctx.stroke();
    }

    // Detected turns, numbered in lap order. The number is this project's
    // own count, not the circuit's official corner numbering — nothing
    // here publishes that — and the page says so beside the table.
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const turn of turns) {
      const [tx, ty] = project(points[turn.apexIndex]);
      const on = highlight === turn.number;
      ctx.beginPath();
      ctx.arc(tx, ty, on ? 11 : 9, 0, Math.PI * 2);
      ctx.fillStyle = on ? cssToken('--accent-0') : cssToken('--bg-1');
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = on ? cssToken('--accent-0') : cssToken('--line-strong');
      ctx.stroke();
      ctx.fillStyle = on ? cssToken('--bg-0') : cssToken('--ink-1');
      ctx.fillText(String(turn.number), tx, ty + 0.5);
    }

    if (hover != null) {
      const [hx, hy] = project(points[hover]);
      ctx.strokeStyle = cssToken('--ink-0');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [points, shaded, project, size, hover, turns, highlight]);

  if (!bounds || !points || points.length < 2) return null;

  const nearestTo = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * size;
    const py = ((event.clientY - rect.top) / rect.height) * size;
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const [x, y] = project(points[i]);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    // Ignore a pointer nowhere near the track rather than snapping the
    // readout to a point the reader is not looking at.
    return bestDistance <= 24 * 24 ? best : null;
  };

  return (
    <div className="gripmap-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, touchAction: 'none' }}
        role="img"
        aria-label="Driven lap coloured by lateral acceleration, low to high"
        onPointerMove={(e) => setHover(nearestTo(e))}
        onPointerLeave={() => setHover(null)}
      />
      <div className="gripmap-side">
        <p className="figure-label">Cornering load</p>
        <ul className="grip-legend">
          {Array.from({ length: BANDS }, (_, i) => (
            <li key={i}>
              <span
                className="grip-swatch"
                style={{ background: `var(--grip-${i + 1})` }}
                aria-hidden="true"
              />
              <span className="mono">
                {i === BANDS - 1
                  ? `${BAND_EDGES[BAND_EDGES.length - 1]}g and up`
                  : `${i === 0 ? 0 : BAND_EDGES[i - 1]}–${BAND_EDGES[i]}g`}
              </span>
            </li>
          ))}
        </ul>
        {hover != null && (
          <p className="grip-readout mono" role="status">
            {Math.abs(lateralG[hover]).toFixed(1)}g at {Math.round(speedKph[hover])} km/h
          </p>
        )}
      </div>
    </div>
  );
}
