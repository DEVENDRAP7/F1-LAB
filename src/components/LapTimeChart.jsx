import { useEffect, useMemo, useRef, useState } from 'react';
import { cssToken } from '../theme/palette.js';

// Lap time against lap number for up to 4 drivers — change over time, so
// a line chart. One y-axis only: every series is in seconds, and a
// second scale is never introduced.
//
// The y-domain is clipped to a percentile window rather than the full
// range, because a single safety-car or pit lap is 40s+ slower than
// green-flag pace and would flatten every real difference into one line.
// Clipped points are drawn as gaps, and the caption says how many.

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[i];
}

export default function LapTimeChart({ series, totalLaps, height = 300 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [hoverLap, setHoverLap] = useState(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { yMin, yMax, clipped, total } = useMemo(() => {
    const all = series.flatMap((s) => s.points.map((p) => p.timeS)).filter((t) => t != null);
    if (all.length === 0) return { yMin: 0, yMax: 1, clipped: 0, total: 0 };
    const sorted = [...all].sort((a, b) => a - b);
    const lo = percentile(sorted, 0.01);
    const hi = percentile(sorted, 0.93);
    const pad = (hi - lo) * 0.12 || 1;
    const min = lo - pad;
    const max = hi + pad;
    return {
      yMin: min,
      yMax: max,
      clipped: all.filter((t) => t < min || t > max).length,
      total: all.length,
    };
  }, [series]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const xAt = (lap) => PAD.left + ((lap - 1) / Math.max(1, totalLaps - 1)) * plotW;
    const yAt = (t) => PAD.top + (1 - (t - yMin) / (yMax - yMin)) * plotH;

    // Recessive grid + axes.
    const line = cssToken('--line');
    const ink2 = cssToken('--ink-2');
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.fillStyle = ink2;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const t = yMin + ((yMax - yMin) * i) / yTicks;
      const y = yAt(t);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.stroke();
      const mins = Math.floor(t / 60);
      const secs = (t - mins * 60).toFixed(1).padStart(4, '0');
      ctx.fillText(mins > 0 ? `${mins}:${secs}` : `${t.toFixed(1)}`, PAD.left - 8, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = totalLaps > 60 ? 20 : 10;
    for (let lap = 1; lap <= totalLaps; lap += step) {
      ctx.fillText(String(lap), xAt(lap), height - PAD.bottom + 6);
    }
    ctx.fillText('lap', width - PAD.right - 12, height - PAD.bottom + 6);

    // Series: 2px lines, gaps where a point is missing or clipped.
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawing = false;
      for (const p of s.points) {
        const t = p.timeS;
        if (t == null || t < yMin || t > yMax) {
          drawing = false;
          continue;
        }
        const x = xAt(p.lap);
        const y = yAt(t);
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Crosshair + 2px surface ring on the marks it touches.
    if (hoverLap != null) {
      ctx.strokeStyle = cssToken('--ink-2');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xAt(hoverLap), PAD.top);
      ctx.lineTo(xAt(hoverLap), height - PAD.bottom);
      ctx.stroke();

      for (const s of series) {
        const p = s.points.find((q) => q.lap === hoverLap);
        if (!p || p.timeS == null || p.timeS < yMin || p.timeS > yMax) continue;
        ctx.beginPath();
        ctx.arc(xAt(p.lap), yAt(p.timeS), 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cssToken('--bg-1');
        ctx.stroke();
      }
    }
  }, [series, width, height, yMin, yMax, totalLaps, hoverLap]);

  const lapFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const plotW = rect.width - PAD.left - PAD.right;
    const frac = (event.clientX - rect.left - PAD.left) / plotW;
    return Math.max(1, Math.min(totalLaps, Math.round(frac * (totalLaps - 1) + 1)));
  };

  const readout = hoverLap
    ? series.map((s) => ({
        code: s.code,
        color: s.color,
        timeS: s.points.find((q) => q.lap === hoverLap)?.timeS ?? null,
      }))
    : [];

  return (
    <div className="laptime-chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        tabIndex={0}
        role="img"
        aria-label="Lap time by lap number for the selected drivers"
        onPointerMove={(e) => setHoverLap(lapFromPointer(e))}
        onPointerLeave={() => setHoverLap(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            setHoverLap((l) => Math.min(totalLaps, (l ?? 0) + 1));
            e.preventDefault();
          } else if (e.key === 'ArrowLeft') {
            setHoverLap((l) => Math.max(1, (l ?? totalLaps + 1) - 1));
            e.preventDefault();
          }
        }}
      />
      {hoverLap != null && (
        <div className="chart-tooltip chart-tooltip-inline" role="status">
          <span className="mono">lap {hoverLap}</span>
          {readout.map((r) => (
            <span key={r.code} className="tooltip-series">
              <span className="tooltip-swatch" style={{ background: r.color }} aria-hidden="true" />
              <span className="mono">{r.code}</span>{' '}
              <span className="mono tabular">
                {r.timeS == null ? '—' : r.timeS.toFixed(3)}
              </span>
            </span>
          ))}
        </div>
      )}
      {clipped > 0 && (
        <p className="chart-caption">
          Y-axis clipped to the 1st–93rd percentile of lap times so green-flag pace stays
          readable; <span className="mono">{clipped}</span> of{' '}
          <span className="mono">{total}</span> laps fall outside and are drawn as gaps
          (safety car, pit laps, damage).
        </p>
      )}
    </div>
  );
}
