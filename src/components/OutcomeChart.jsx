import { useEffect, useMemo, useRef, useState } from 'react';
import { cssToken } from '../theme/palette.js';
import { formatDuration } from '../lib/formatTime.js';

// Where the model's runs landed, against the race that actually happened.
//
// A single median would read as a prediction. The spread is the honest
// part of the output: it comes from sampling each stint's degradation
// rate inside its fitted confidence interval and each stop inside the
// scatter of the driver's own measured stops, so a wide distribution is
// the model saying it does not know rather than the chart being noisy.
//
// The actual race time is drawn as a hard rule through the histogram,
// because every reading of this chart is "compared to what happened".

const PAD = { top: 18, right: 16, bottom: 40, left: 16 };
const BINS = 24;

export default function OutcomeChart({ totals, actualS, height = 200 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const histogram = useMemo(() => {
    if (totals.length === 0) return null;
    const lo = Math.min(...totals, actualS);
    const hi = Math.max(...totals, actualS);
    const span = hi - lo || 1;
    const counts = new Array(BINS).fill(0);
    for (const t of totals) {
      const b = Math.min(BINS - 1, Math.floor(((t - lo) / span) * BINS));
      counts[b] += 1;
    }
    return { lo, hi, span, counts, peak: Math.max(...counts) };
  }, [totals, actualS]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !histogram || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const xAt = (t) => PAD.left + ((t - histogram.lo) / histogram.span) * plotW;
    const barW = plotW / BINS;

    ctx.fillStyle = cssToken('--series-1');
    histogram.counts.forEach((count, i) => {
      if (count === 0) return;
      const h = (count / histogram.peak) * plotH;
      ctx.fillRect(PAD.left + i * barW + 0.5, PAD.top + plotH - h, Math.max(1, barW - 1), h);
    });

    // The race as it happened.
    const x = xAt(actualS);
    ctx.strokeStyle = cssToken('--hot-0');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, PAD.top - 6);
    ctx.lineTo(x, PAD.top + plotH);
    ctx.stroke();

    ctx.fillStyle = cssToken('--hot-0');
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = x > width / 2 ? 'right' : 'left';
    ctx.fillText('actual', x + (x > width / 2 ? -6 : 6), PAD.top - 4);

    ctx.fillStyle = cssToken('--ink-2');
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatDuration(histogram.lo), PAD.left, PAD.top + plotH + 8);
    ctx.textAlign = 'right';
    ctx.fillText(formatDuration(histogram.hi), width - PAD.right, PAD.top + plotH + 8);
  }, [histogram, width, height, actualS]);

  if (!histogram) return null;

  return (
    <div className="laptime-chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        role="img"
        aria-label="Distribution of modelled race times, with the actual race time marked"
      />
      <p className="chart-caption">
        Each bar counts runs of the model that landed in that range of total race time. The
        spread comes from sampling each stint's degradation rate inside its fitted confidence
        interval and each stop inside the scatter of this driver's own measured stops.
      </p>
    </div>
  );
}
