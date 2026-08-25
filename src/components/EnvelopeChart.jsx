import { useEffect, useMemo, useRef, useState } from 'react';
import { cssToken } from '../theme/palette.js';
import { ENVELOPE_BIN_KPH } from '../lib/aero.js';

// Lateral g against speed — the shape that shows aerodynamic grip
// arriving. Each point is one speed band's 95th-percentile lateral g, so
// the line is "how much the car sustained around here", not the single
// most extreme sample, which on a differentiated trace is usually noise.
//
// Bands with too few samples are already dropped upstream, which means a
// series can have gaps in the middle of its speed range. Those are drawn
// as gaps rather than bridged: a straight segment across a band nobody
// spent time in would assert a grip level that was never measured.

// Right padding carries the unit that rides on the last x tick.
const PAD = { top: 16, right: 44, bottom: 34, left: 46 };

export default function EnvelopeChart({ series, height = 300 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // One scale across every series, so two drivers are actually
  // comparable — a per-series scale would make the slower car's envelope
  // look identical to the faster one's.
  const bounds = useMemo(() => {
    let maxG = 0;
    let minSpeed = Infinity;
    let maxSpeed = 0;
    for (const s of series) {
      for (const p of s.envelope) {
        if (p.lateralG > maxG) maxG = p.lateralG;
        if (p.speedKph < minSpeed) minSpeed = p.speedKph;
        if (p.speedKph > maxSpeed) maxSpeed = p.speedKph;
      }
    }
    if (!Number.isFinite(minSpeed)) return null;
    return {
      gMax: Math.max(1, Math.ceil(maxG)),
      speedMin: Math.max(0, Math.floor((minSpeed - 20) / 50) * 50),
      speedMax: Math.ceil((maxSpeed + 20) / 50) * 50,
    };
  }, [series]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const span = Math.max(1, bounds.speedMax - bounds.speedMin);
    const xAt = (kph) => PAD.left + ((kph - bounds.speedMin) / span) * plotW;
    const yAt = (g) => PAD.top + (1 - g / bounds.gMax) * plotH;

    ctx.font = '11px ui-monospace, monospace';
    ctx.strokeStyle = cssToken('--line');
    ctx.fillStyle = cssToken('--ink-2');
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Whole-g gridlines. A step of gMax/4 puts lines at 2.25g and 6.75g,
    // which are not numbers anyone reads a g figure in.
    const gStep = bounds.gMax <= 5 ? 1 : bounds.gMax <= 12 ? 2 : 5;
    for (let g = 0; g <= bounds.gMax + 1e-9; g += gStep) {
      const y = yAt(g);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.stroke();
      ctx.fillText(`${g}g`, PAD.left - 8, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // At phone width a 50 km/h step runs the last two labels into each
    // other, so the step doubles rather than the labels overlapping.
    const kphStep = plotW > 520 ? 50 : 100;
    for (let kph = bounds.speedMin; kph <= bounds.speedMax; kph += kphStep) {
      // The unit rides on the last tick: drawn separately at the right
      // edge it landed on top of that tick's own label.
      const last = kph + kphStep > bounds.speedMax;
      ctx.fillText(last ? `${kph} km/h` : String(kph), xAt(kph), height - PAD.bottom + 8);
    }

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let open = false;
      let previousBin = null;
      for (const p of s.envelope) {
        const x = xAt(p.speedKph);
        const y = yAt(p.lateralG);
        // A skipped band is a gap in the measurement, so lift the pen.
        const contiguous =
          previousBin != null && p.speedKph - previousBin < 1.5 * ENVELOPE_BIN_KPH;
        if (!open || !contiguous) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        open = true;
        previousBin = p.speedKph;
      }
      ctx.stroke();

      for (const p of s.envelope) {
        ctx.beginPath();
        ctx.arc(xAt(p.speedKph), yAt(p.lateralG), 3, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }
  }, [series, bounds, width, height]);

  if (!bounds) {
    return (
      <p className="panel-note">
        No speed band on this lap collected enough samples to state an envelope for.
      </p>
    );
  }

  return (
    <div className="laptime-chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        role="img"
        aria-label="Sustained lateral acceleration against speed for the selected drivers"
      />
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.code} className="legend-item">
            <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="mono">{s.code}</span>
          </span>
        ))}
      </div>
      <p className="chart-caption">
        Each point is the 95th percentile of lateral g among samples in a 20 km/h band, and a
        band with fewer than eight samples is left out rather than drawn thin — so a line can
        have gaps, and a gap means the lap spent no meaningful time at that speed.
      </p>
    </div>
  );
}
