import { useEffect, useMemo, useRef, useState } from 'react';
import { fitBox } from '../lib/trackFit.js';
import { cssToken } from '../theme/palette.js';

// The driven line, coloured by one channel of it — cornering load,
// speed, throttle, gear or the brake. The braking zones, the corners and
// the straights fall out of the colour without anyone labelling them.
//
// Magnitude, so a sequential ramp: one hue, low to high. Colour is not
// the only channel — every band is labelled with the values it covers,
// and hovering reads the figure at a point, so a reader who cannot
// separate two steps can still get the number.
//
// Banded rather than continuous on purpose. A continuous gradient invites
// reading a precision off the colour that the underlying measurement does
// not have; a handful of bands say "about this much", which is what it
// supports. The band edges are the caller's: they belong with the channel
// being drawn, not with the drawing.
const PAD = 26;

// Colour is smoothed over this many samples either side (about 20 m of
// track) before it is banded. Per-sample lateral g flips across a band
// edge several times through one corner — the underlying fit is per
// sample and a corner is not perfectly even — and the map came out
// speckled, which reads as noise rather than as a corner. The smoothing
// is for the colour only: every number on the page still comes from the
// unsmoothed values. A channel the source publishes directly (the brake,
// the gear) is drawn unsmoothed, since there is nothing to smooth out.
const COLOUR_SMOOTHING = 5;

// The ramp has five validated steps. A channel with fewer bands takes
// the ends and skips the middle rather than inventing intermediate
// colours, so every step drawn is one that was checked against the
// surface it is drawn on.
const RAMP_STEPS = 5;

function rampIndex(band, bands) {
  if (bands >= RAMP_STEPS) return Math.min(band, RAMP_STEPS - 1);
  return Math.round((band / Math.max(1, bands - 1)) * (RAMP_STEPS - 1));
}

function rampToken(band, bands) {
  return `var(--grip-${rampIndex(band, bands) + 1})`;
}

function rampFor(bands) {
  return Array.from({ length: bands }, (_, i) => cssToken(`--grip-${rampIndex(i, bands) + 1}`));
}

// The unit goes on the band, not on both of its ends: "100 km/h–175
// km/h" is the same fact written twice.
function bandLabel(band, edges, unit, labels) {
  if (labels) return labels[band];
  if (edges.length === 0) return 'all';
  if (band === 0) return `under ${edges[0]}${unit}`;
  if (band === edges.length) return `${edges[edges.length - 1]}${unit} and up`;
  return `${edges[band - 1]}–${edges[band]}${unit}`;
}

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

function bandFor(value, edges) {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  let band = 0;
  while (band < edges.length && magnitude >= edges[band]) band += 1;
  return band;
}

export default function ChannelMap({
  points,
  values,
  bandEdges,
  label,
  unit = '',
  bandLabels = null,
  // Explicit colours, for a map whose bands are identities rather than
  // magnitudes: who was fastest through a piece of track is categorical,
  // and a sequential ramp would imply an order that does not exist.
  bandColors = null,
  formatValue = (v) => v.toFixed(1),
  smooth = true,
  turns = [],
  highlight = null,
  height = 420,
}) {
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

  // The canvas takes the track's proportions instead of being square.
  // A square canvas meant a tall circuit was drawn at about half the
  // size the panel allowed, with the rest of the width empty — see
  // lib/trackFit.js, which the SVG track map uses for the same reason.
  // The long side is whatever the panel gives us, capped at the height
  // this component was asked for.
  const box = useMemo(
    () => fitBox(bounds, { long: Math.min(width, height), pad: PAD }),
    [bounds, width, height],
  );
  const boxW = box?.width ?? 0;
  const boxH = box?.height ?? 0;
  const project = box?.project ?? null;

  const bands = bandEdges.length + 1;
  const shaded = useMemo(
    () => (smooth ? smoothMagnitude(values, COLOUR_SMOOTHING) : values),
    [values, smooth],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project || !points || points.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = boxW * dpr;
    canvas.height = boxH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);

    const colors = bandColors ?? rampFor(bands);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // One stroke per band rather than per segment: a stroke call for each
    // of a couple of thousand points is what makes a canvas map crawl.
    for (let band = 0; band < bands; band += 1) {
      ctx.strokeStyle = colors[band];
      ctx.beginPath();
      let open = false;
      for (let i = 1; i < points.length; i += 1) {
        if (bandFor(shaded[i], bandEdges) !== band) {
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
  }, [points, shaded, bandEdges, bands, bandColors, project, boxW, boxH, hover, turns, highlight]);

  if (!bounds || !points || points.length < 2) return null;

  const nearestTo = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * boxW;
    const py = ((event.clientY - rect.top) / rect.height) * boxH;
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
        style={{ width: boxW, height: boxH, touchAction: 'none' }}
        role="img"
        aria-label={`Driven lap coloured by ${label}, low to high`}
        onPointerMove={(e) => setHover(nearestTo(e))}
        onPointerLeave={() => setHover(null)}
      />
      <div className="gripmap-side">
        <p className="figure-label">{label}</p>
        <ul className="grip-legend">
          {Array.from({ length: bands }, (_, i) => (
            <li key={i}>
              <span
                className="grip-swatch"
                style={{ background: bandColors ? bandColors[i] : rampToken(i, bands) }}
                aria-hidden="true"
              />
              <span className="mono">{bandLabel(i, bandEdges, unit, bandLabels)}</span>
            </li>
          ))}
        </ul>
        {hover != null && (
          <p className="grip-readout mono" role="status">
            {formatValue(values[hover])}
          </p>
        )}
      </div>
    </div>
  );
}
