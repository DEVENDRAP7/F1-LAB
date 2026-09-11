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
import { extentOf, fitBox } from '../lib/trackFit.js';

export default function TrackMap({ outline, corners = [], lines = [], marker = null, long = 640 }) {
  if (!outline || outline.length === 0) {
    return null;
  }

  // The box takes the track's proportions rather than a fixed square —
  // see lib/trackFit.js. The extent covers the driven lines and the
  // crosshair too, because a lap that runs wide of the outline is
  // exactly the bit worth seeing and must not be cropped.
  const box = fitBox(
    extentOf(outline, ...lines.map((l) => l.points), marker ? [marker] : []),
    { long },
  );
  if (!box) return null;
  const { width, height, project } = box;

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
            {/* A filled disc with the number inside it, rather than a dot
                with a label floating beside it: on a map this size the
                floating label reads as belonging to whichever bit of
                track it happens to sit nearest. */}
            <circle
              cx={cx}
              cy={cy}
              r={9}
              fill="var(--bg-1)"
              stroke="var(--accent-0)"
              strokeWidth={1.5}
            />
            <text
              x={cx}
              y={cy}
              className="mono"
              fontSize={10}
              fontWeight={600}
              fill="var(--ink-0)"
              textAnchor="middle"
              dominantBaseline="central"
            >
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
