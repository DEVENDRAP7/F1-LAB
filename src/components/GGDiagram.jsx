import { useEffect, useMemo, useRef, useState } from 'react';
import { cssToken } from '../theme/palette.js';

// The g-g diagram: every sample of a lap plotted as lateral against
// longitudinal acceleration. The outline it traces is the limit the car
// actually operated at — hard braking at the bottom, cornering at the
// sides, traction out of a corner at the top.
//
// It is a scatter, so the dataviz all-pairs rule applies: only the first
// three categorical slots clear the colour floors when every pair can
// appear beside every other. The caller caps the comparison at three
// drivers for that reason, not for screen space.
//
// Reference rings are drawn at whole-g intervals and labelled, because
// the shape means nothing without a scale to read it against.

const PAD = 44;

export default function GGDiagram({ series, height = 420 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(560);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // One shared scale across drivers: a per-driver scale would make a
  // car that pulls less g look identical to one that pulls more.
  // Scaled to the sustained figures rather than to the single largest
  // sample. Differentiating an interpolated trace leaves a few samples
  // per lap well outside what the car did, and scaling to those shrinks
  // the whole lap into a smudge in the middle — which is exactly what
  // this chart did on its first real render. Anything past the edge is
  // clipped, not silently rescaled away.
  const limit = useMemo(() => {
    let max = 1;
    for (const s of series) {
      max = Math.max(max, s.peaks.peakLateralG, s.peaks.peakBrakingG, s.peaks.peakAccelG);
    }
    return Math.ceil(max + 0.5);
  }, [series]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const size = Math.min(width, height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - PAD;
    const toPx = (g) => (g / limit) * radius;

    // Reference rings.
    ctx.strokeStyle = cssToken('--line');
    ctx.fillStyle = cssToken('--ink-2');
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1;
    for (let g = 1; g <= limit; g += 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, toPx(g), 0, Math.PI * 2);
      ctx.stroke();
      // Labelled along one diagonal: stacked up the vertical axis they
      // collide as soon as the rings are close together.
      const d = toPx(g) / Math.SQRT2;
      ctx.fillText(`${g}g`, cx + d, cy - d - 4);
    }

    // Axes.
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    ctx.fillStyle = cssToken('--ink-2');
    ctx.textAlign = 'left';
    ctx.fillText('cornering →', cx + 8, cy - 8);
    ctx.textAlign = 'center';
    ctx.fillText('acceleration', cx, cy - radius - 18);
    ctx.fillText('braking', cx, cy + radius + 22);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    for (const s of series) {
      ctx.fillStyle = s.color;
      // Thousands of samples overlap heavily; partial alpha turns that
      // overlap into density, so where the car spent its lap reads
      // darker than where it passed through once.
      ctx.globalAlpha = 0.55;
      const { lateralG, longitudinalG } = s.trace;
      for (let i = 0; i < lateralG.length; i += 1) {
        const px = cx + toPx(lateralG[i]);
        // Screen y grows downward; braking is negative g and belongs at
        // the bottom, so the sign flips here rather than in the physics.
        const py = cy - toPx(longitudinalG[i]);
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }, [series, width, height, limit]);

  return (
    <div className="gg-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: Math.min(width, height), height: Math.min(width, height) }}
        role="img"
        aria-label={
          `Acceleration envelope for ${series.map((s) => s.code).join(', ')}: lateral `
          + `acceleration horizontally, braking and acceleration vertically, rings at whole g.`
        }
      />
    </div>
  );
}
