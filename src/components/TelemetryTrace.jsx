import { useEffect, useRef } from 'react';
import { cssToken } from '../theme/palette.js';

// One trace panel on the shared distance axis (M3). Several instances
// stack under the track map; the parent owns the crosshair index and
// passes the same value to every panel and to the map, which is what
// binds them into one instrument (docs/SPEC.md section 5).
//
// `series` is [{ code, color, values }] where values is any indexable
// numeric array (Int16Array straight from the decoder, or Float64Array
// from lib/delta.js) — no per-sample object allocation anywhere.
export default function TelemetryTrace({
  label,
  unit,
  series,
  spacingM,
  crosshairIndex,
  onCrosshair,
  height = 120,
  formatValue = (v) => String(v),
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || series.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const n = Math.min(...series.map((s) => s.values.length));
    if (n < 2) return;

    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = 6;
    const xAt = (i) => (i / (n - 1)) * width;
    const yAt = (v) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);

    // Zero line, meaningful for the delta trace.
    if (min < 0 && max > 0) {
      ctx.strokeStyle = cssToken('--line');
      ctx.beginPath();
      ctx.moveTo(0, yAt(0));
      ctx.lineTo(width, yAt(0));
      ctx.stroke();
    }

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(s.values[0]));
      for (let i = 1; i < n; i++) {
        ctx.lineTo(xAt(i), yAt(s.values[i]));
      }
      ctx.stroke();
    }

    if (crosshairIndex != null && crosshairIndex >= 0 && crosshairIndex < n) {
      ctx.strokeStyle = cssToken('--ink-1');
      ctx.beginPath();
      ctx.moveTo(xAt(crosshairIndex), 0);
      ctx.lineTo(xAt(crosshairIndex), height);
      ctx.stroke();
    }
  }, [series, crosshairIndex, height]);

  const n = series.length > 0 ? Math.min(...series.map((s) => s.values.length)) : 0;

  const indexFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
  };

  const handleKey = (event) => {
    if (crosshairIndex == null) return;
    const step = event.shiftKey ? 25 : 1;
    if (event.key === 'ArrowRight') {
      onCrosshair(Math.min(n - 1, crosshairIndex + step));
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      onCrosshair(Math.max(0, crosshairIndex - step));
      event.preventDefault();
    }
  };

  return (
    <div className="trace-panel">
      <div className="trace-header">
        <span className="trace-label">{label}</span>
        {crosshairIndex != null && crosshairIndex < n && (
          <span className="mono trace-readout">
            {(crosshairIndex * spacingM).toFixed(0)} m
            {series.map((s) => (
              <span key={s.code} style={{ color: s.color }} className="trace-readout-value">
                {' '}
                {s.code} {formatValue(s.values[crosshairIndex])}
                {unit}
              </span>
            ))}
          </span>
        )}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        tabIndex={0}
        role="img"
        aria-label={`${label} trace; use arrow keys to move the crosshair`}
        onPointerMove={(e) => onCrosshair(indexFromPointer(e))}
        onKeyDown={handleKey}
      />
    </div>
  );
}
