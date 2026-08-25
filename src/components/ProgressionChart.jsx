import { useEffect, useMemo, useRef, useState } from 'react';
import { cssToken } from '../theme/palette.js';

// Cumulative championship points by round — a running total over an
// ordered sequence, so a line chart, on one y-axis in points.
//
// Rounds are plotted at equal spacing by their index rather than by
// date: the axis is "races completed", which is what the points total
// actually advances with. Spacing them by calendar date would imply the
// gaps between races carry information they do not.

const PAD = { top: 14, right: 14, bottom: 28, left: 44 };
const Y_TICKS = 4;

export default function ProgressionChart({ progression, series, height = 300 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Points are a count, so the axis should read in round counts —
  // gridlines at the data's exact maximum (0, 61, 121, 182, 242) are
  // numbers nobody thinks in. Round the step up to a 1/2/5 x 10^k value
  // and extend the top of the axis to the next multiple of it.
  const axis = useMemo(() => {
    let raw = 0;
    for (const snapshot of progression) {
      for (const s of series) {
        const v = snapshot.points[s.code] ?? 0;
        if (v > raw) raw = v;
      }
    }
    if (raw <= 0) return { max: 1, step: 1 };
    const target = raw / Y_TICKS;
    const pow10 = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 5, 10].map((m) => m * pow10).find((s) => s >= target) ?? pow10 * 10;
    return { max: Math.ceil(raw / step) * step, step };
  }, [progression, series]);
  const yMax = axis.max;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || progression.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const n = progression.length;
    const xAt = (i) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yAt = (v) => PAD.top + (1 - v / yMax) * plotH;

    ctx.strokeStyle = cssToken('--line');
    ctx.fillStyle = cssToken('--ink-2');
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let v = 0; v <= yMax + 1e-9; v += axis.step) {
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(v)), PAD.left - 8, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Label as many round numbers as fit without colliding.
    const minGap = 26;
    const step = Math.max(1, Math.ceil((n * minGap) / Math.max(plotW, 1)));
    for (let i = 0; i < n; i += step) {
      ctx.fillText(String(progression[i].round), xAt(i), height - PAD.bottom + 6);
    }

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      progression.forEach((snapshot, i) => {
        const v = snapshot.points[s.code] ?? 0;
        const x = xAt(i);
        const y = yAt(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    if (hoverIndex != null && hoverIndex >= 0 && hoverIndex < n) {
      ctx.strokeStyle = cssToken('--ink-2');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xAt(hoverIndex), PAD.top);
      ctx.lineTo(xAt(hoverIndex), height - PAD.bottom);
      ctx.stroke();

      for (const s of series) {
        const v = progression[hoverIndex].points[s.code] ?? 0;
        ctx.beginPath();
        ctx.arc(xAt(hoverIndex), yAt(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cssToken('--bg-1');
        ctx.stroke();
      }
    }
  }, [progression, series, width, height, axis, yMax, hoverIndex]);

  const indexFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const plotW = rect.width - PAD.left - PAD.right;
    const frac = (event.clientX - rect.left - PAD.left) / plotW;
    return Math.max(0, Math.min(progression.length - 1, Math.round(frac * (progression.length - 1))));
  };

  const snapshot = hoverIndex != null ? progression[hoverIndex] : null;

  return (
    <div className="laptime-chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        tabIndex={0}
        role="img"
        aria-label="Cumulative championship points by round for the selected drivers"
        onPointerMove={(e) => setHoverIndex(indexFromPointer(e))}
        onPointerLeave={() => setHoverIndex(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            setHoverIndex((i) => Math.min(progression.length - 1, (i ?? -1) + 1));
            e.preventDefault();
          } else if (e.key === 'ArrowLeft') {
            setHoverIndex((i) => Math.max(0, (i ?? progression.length) - 1));
            e.preventDefault();
          }
        }}
      />
      {snapshot && (
        <div className="chart-tooltip chart-tooltip-inline" role="status">
          <span className="mono">
            R{snapshot.round} {snapshot.raceName}
          </span>
          {series.map((s) => (
            <span key={s.code} className="tooltip-series">
              <span className="tooltip-swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="mono">{s.code}</span>{' '}
              <span className="mono tabular">{snapshot.points[s.code] ?? 0}</span>
            </span>
          ))}
        </div>
      )}
      <p className="chart-caption">
        Rounds are equally spaced by race number, not by calendar date — the axis is races
        completed, which is what a points total advances with.
      </p>
    </div>
  );
}
