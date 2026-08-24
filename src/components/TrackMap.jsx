// M3 signature element: the crosshair binding this map to the linked
// telemetry/delta traces lives one level up (it drives both), so this
// component only draws the static outline + corner markers from a
// circuit artifact and renders driven lines passed in as props.
//
// `outline` is an array of [x, y] metres (already rotated by
// circuit_info.rotation at build time — see docs/SPEC.md). `lines` is an
// array of { code, color, points } where points come from
// lib/racingLine.js's decoded x/y channels.
// `marker` is an optional [x, y] in metres — the crosshair's position on
// the map, driven by the same index the telemetry traces use.
export default function TrackMap({ outline, corners = [], lines = [], marker = null, width = 640, height = 640 }) {
  if (!outline || outline.length === 0) {
    return null;
  }

  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 40;
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));

  const project = ([x, y]) => [
    pad + (x - minX) * scale,
    height - pad - (y - minY) * scale,
  ];

  const outlinePath = outline
    .map(project)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  return (
    <svg
      className="track-map"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: width, height: 'auto' }}
      role="img"
      aria-label="Circuit track map"
    >
      <path d={outlinePath} fill="none" stroke="var(--ink-2)" strokeWidth={2} />
      {corners.map((corner) => {
        const [cx, cy] = project([corner.x, corner.y]);
        return (
          <g key={corner.number}>
            <circle cx={cx} cy={cy} r={4} fill="var(--ink-1)" />
            <text x={cx + 6} y={cy - 6} className="mono" fontSize={10} fill="var(--ink-1)">
              {corner.number}
            </text>
          </g>
        );
      })}
      {lines.map((line) => (
        <path
          key={line.code}
          d={line.points
            .map(project)
            .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
            .join(' ')}
          fill="none"
          stroke={line.color}
          strokeWidth={1.5}
          opacity={0.9}
        />
      ))}
      {marker && (
        <circle
          cx={project(marker)[0]}
          cy={project(marker)[1]}
          r={5}
          fill="none"
          stroke="var(--ink-0)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
