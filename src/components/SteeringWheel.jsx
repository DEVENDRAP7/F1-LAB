import { useMemo, useState } from 'react';
import {
  BUTTONS, CONTROL_KIND, FIXTURES, ROTARIES,
  describe, initialPositions,
} from '../lib/steeringWheel.js';

// A 2026 steering wheel you can actually work.
//
// Drawn as SVG rather than added to the 3D car: the job is reading small
// labels and hitting small targets, which flat vector does far better
// than a mesh you have to orbit to see the far side of — and it adds no
// geometry, no texture and nothing to the initial bundle.
//
// The rotaries turn. Clicking a position drives the knob to it and the
// display follows, because a wheel you can only read is a diagram, and
// the thing worth understanding here is that one switch changes how the
// whole car behaves.

const RING_IN = 44;
const RING_OUT = 70;

function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** One annular segment of a rotary's collar. */
function wedge(cx, cy, rIn, rOut, a0, a1) {
  const [x0, y0] = polar(cx, cy, rOut, a0);
  const [x1, y1] = polar(cx, cy, rOut, a1);
  const [x2, y2] = polar(cx, cy, rIn, a1);
  const [x3, y3] = polar(cx, cy, rIn, a0);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${rOut} ${rOut} 0 ${big} 1 ${x1} ${y1} `
    + `L${x2} ${y2} A${rIn} ${rIn} 0 ${big} 0 ${x3} ${y3} Z`;
}

export default function SteeringWheel() {
  const [positions, setPositions] = useState(initialPositions);
  const [pressed, setPressed] = useState({});
  const [pinned, setPinned] = useState(null);
  const [hovered, setHovered] = useState(null);

  const shown = pinned ?? hovered;
  const info = describe(shown);

  // What the display is currently reporting, straight off the switches.
  const readout = useMemo(() => {
    const at = (id) => {
      const rotary = ROTARIES.find((r) => r.id === id);
      return rotary.positions[positions[id]].label;
    };
    return { engine: at('engine'), strategy: at('strategy'), braking: at('braking') };
  }, [positions]);

  const target = (id) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${describe(id).name}. ${describe(id).text}`,
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
    onFocus: () => setHovered(id),
    onBlur: () => setHovered((h) => (h === id ? null : h)),
  });

  const activate = (id, act) => ({
    ...target(id),
    onClick: () => { act(); setPinned(id); },
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); setPinned(id); }
    },
  });

  const press = (id) => setPressed((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="wheel-layout">
      <svg
        className="wheel-svg"
        viewBox="0 0 900 620"
        role="group"
        aria-label="Interactive diagram of a 2026 Formula 1 steering wheel"
      >
        <defs>
          <linearGradient id="wheelFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bg-3)" />
            <stop offset="1" stopColor="var(--bg-1)" />
          </linearGradient>
          <linearGradient id="wheelGrip" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--bg-3)" />
            <stop offset="0.5" stopColor="var(--bg-2)" />
            <stop offset="1" stopColor="var(--bg-0)" />
          </linearGradient>
        </defs>

        {/* Grips. A thick stroked curve gives the sculpted handle these
            have, without a hand-written outline for every millimetre. */}
        <path className="wheel-grip" d="M232 348 C 150 392 132 470 176 566" />
        <path className="wheel-grip" d="M668 348 C 750 392 768 470 724 566" />
        <path className="wheel-grip-inner" d="M244 366 C 182 402 170 464 202 540" />
        <path className="wheel-grip-inner" d="M656 366 C 718 402 730 464 698 540" />

        {/* Paddles, ghosted behind the wheel because that is where they sit. */}
        {[['clutch', 150], ['shift', 750]].map(([id, x]) => (
          <g key={id} className={`wheel-hit${shown === `fix:${id}` ? ' is-on' : ''}`}
            {...activate(`fix:${id}`, () => {})}
          >
            <rect className="wheel-paddle" x={x - 74} y="556" width="148" height="34" rx="12" />
            <text className="wheel-tag" x={x} y={578}>{id === 'shift' ? 'SHIFT' : 'CLUTCH'}</text>
          </g>
        ))}

        {/* Upper face */}
        <path
          className="wheel-face"
          d="M186 96 h528 a30 30 0 0 1 30 30 v206 a26 26 0 0 1 -26 26 h-536
             a26 26 0 0 1 -26 -26 v-206 a30 30 0 0 1 30 -30 z"
        />
        {/* Lower rotary panel */}
        <rect className="wheel-panel" x="212" y="366" width="476" height="208" rx="20" />

        {/* Shift lights */}
        <g className={`wheel-hit${shown === 'fix:leds' ? ' is-on' : ''}`}
          {...activate('fix:leds', () => {})}
        >
          <rect className="wheel-screen-bed" x="330" y="112" width="240" height="26" rx="10" />
          {Array.from({ length: 13 }, (_, i) => (
            <circle
              key={i}
              className={`wheel-led wheel-led-${i < 5 ? 'a' : i < 9 ? 'b' : 'c'}`}
              cx={344 + i * 18} cy="125" r="5.2"
            />
          ))}
        </g>

        {/* Display — it reports the switch positions below it */}
        <g className={`wheel-hit${shown === 'fix:display' ? ' is-on' : ''}`}
          {...activate('fix:display', () => {})}
        >
          {/* Laid out in three bands — a small top line, the gear on its
              own, then the modes — because a 52px digit centred across a
              line of 20px values collides with them, and a fourth row of
              text fell off the bottom of the screen entirely. */}
          <rect className="wheel-screen-bed" x="322" y="146" width="256" height="154" rx="12" />
          <text className="wheel-lcd-sm" x="338" y="170">SPD 298</text>
          <text className="wheel-lcd-sm wheel-right" x="562" y="170">1:18.412</text>
          <text className="wheel-gear" x="450" y="226">8</text>
          <text className="wheel-lcd-row" x="338" y="258">{`ENG ${readout.engine}`}</text>
          <text className="wheel-lcd-row wheel-right" x="562" y="258">
            {`STR ${readout.strategy}`}
          </text>
          <text className="wheel-lcd-row" x="338" y="284">{`ENB ${readout.braking}`}</text>
          <text className="wheel-lcd-row wheel-right" x="562" y="284">
            {pressed.aero ? 'AERO X' : 'AERO Z'}
          </text>
        </g>

        {/* Buttons */}
        {BUTTONS.map((b) => {
          const on = pressed[b.id];
          const id = `btn:${b.id}`;
          return (
            <g key={b.id}
              className={`wheel-hit${shown === id ? ' is-on' : ''}${on ? ' is-lit' : ''}`}
              {...activate(id, () => press(b.id))}
            >
              <circle className={`wheel-button tone-${b.tone}`} cx={b.x} cy={b.y} r={b.r} />
              <text className="wheel-btn-label" x={b.x} y={b.y + 5}>{b.label}</text>
            </g>
          );
        })}

        {/* Rotaries */}
        {ROTARIES.map((rot) => {
          const n = rot.positions.length;
          const step = 360 / n;
          const sel = positions[rot.id];
          return (
            <g key={rot.id}>
              {rot.positions.map((p, i) => {
                const id = `pos:${rot.id}:${i}`;
                const [lx, ly] = polar(rot.cx, rot.cy, (RING_IN + RING_OUT) / 2, i * step);
                return (
                  <g key={p.label}
                    className={`wheel-hit${shown === id ? ' is-on' : ''}`}
                    {...activate(id, () => setPositions((s) => ({ ...s, [rot.id]: i })))}
                  >
                    <path
                      className={`wheel-wedge tone-${i % 6}${sel === i ? ' is-sel' : ''}`}
                      d={wedge(rot.cx, rot.cy, RING_IN, RING_OUT,
                        i * step - step / 2 + 1, i * step + step / 2 - 1)}
                    />
                    <text className="wheel-pos" x={lx} y={ly + 3.5}>{p.label}</text>
                  </g>
                );
              })}
              <g className={`wheel-hit${shown === `rot:${rot.id}` ? ' is-on' : ''}`}
                {...activate(`rot:${rot.id}`,
                  () => setPositions((s) => ({ ...s, [rot.id]: (s[rot.id] + 1) % n })))}
              >
                <circle className="wheel-knob" cx={rot.cx} cy={rot.cy} r={RING_IN - 5} />
                <g transform={`rotate(${sel * step} ${rot.cx} ${rot.cy})`}>
                  <rect
                    className="wheel-knob-grip"
                    x={rot.cx - 8} y={rot.cy - RING_IN + 10}
                    width="16" height={RING_IN - 4} rx="7"
                  />
                </g>
              </g>
              <text className="wheel-tag" x={rot.cx} y={rot.cy - RING_OUT - 10}>{rot.label}</text>
            </g>
          );
        })}
      </svg>

      <div className="wheel-readout-panel" aria-live="polite">
        <h3>{info.name}</h3>
        {info.kind && <p className="wheel-kind mono">{CONTROL_KIND[info.kind]}</p>}
        <p>{info.text}</p>
        {pinned && (
          <button type="button" className="link-button" onClick={() => setPinned(null)}>
            clear
          </button>
        )}
      </div>
    </div>
  );
}

export { FIXTURES };
