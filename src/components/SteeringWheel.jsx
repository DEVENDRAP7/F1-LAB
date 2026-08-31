import { useState } from 'react';
import { CONTROLS, CONTROL_KIND, controlInfo } from '../lib/steeringWheel.js';

// An annotated 2026 steering wheel. Drawn as SVG rather than added to the
// 3D rig on purpose: the point here is reading labels and hitting small
// targets, and flat vector shapes do both better than a mesh you have to
// orbit to. It also costs nothing — no geometry, no texture, no chunk.
//
// Hover previews a control, clicking pins it. Pinning matters on a phone,
// where there is no hover at all: a tap has to be able to leave the
// description on screen while the reader looks back at the wheel.

const ROTARY_R = 26;
const BUTTON_R = 15;

export default function SteeringWheel() {
  const [pinned, setPinned] = useState(null);
  const [hovered, setHovered] = useState(null);
  const shown = pinned ?? hovered;
  const info = controlInfo(shown);
  const isOn = (id) => shown === id;

  // One handler set per control, so a keyboard reaches everything a
  // pointer can: the wheel is a row of small targets and skipping that
  // would make the whole panel mouse-only.
  const handlers = (id) => ({
    tabIndex: 0,
    role: 'button',
    'aria-pressed': pinned === id,
    'aria-label': `${controlInfo(id).name}: ${controlInfo(id).text}`,
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
    onFocus: () => setHovered(id),
    onBlur: () => setHovered((h) => (h === id ? null : h)),
    onClick: () => setPinned((p) => (p === id ? null : id)),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setPinned((p) => (p === id ? null : id));
      }
    },
  });

  const rotaries = CONTROLS.filter((c) => c.kind === 'rotary');
  const buttons = CONTROLS.filter((c) => c.kind === 'button');

  return (
    <div className="wheel-layout">
      <svg
        className="wheel-svg"
        viewBox="0 0 420 320"
        role="group"
        aria-label="Interactive diagram of a 2026 Formula 1 steering wheel"
      >
        {/* Body: a squared-off wheel with a grip either side and the
            top cut away, which is the shape these have been for years. */}
        <path
          className="wheel-body"
          d="M46 66 h328 a16 16 0 0 1 16 16 v104 a30 30 0 0 1 -30 30 h-24
             a12 12 0 0 0 -12 12 v34 a16 16 0 0 1 -16 16 h-56 a14 14 0 0 1 -14 -14
             v-40 h-56 v40 a14 14 0 0 1 -14 14 h-56 a16 16 0 0 1 -16 -16 v-34
             a12 12 0 0 0 -12 -12 h-24 a30 30 0 0 1 -30 -30 v-104 a16 16 0 0 1 16 -16 z"
        />

        {/* Paddles, ghosted behind the wheel because that is where they are. */}
        {CONTROLS.filter((c) => c.kind === 'paddle').map((c) => (
          <g key={c.id} className={`wheel-hit${isOn(c.id) ? ' is-on' : ''}`} {...handlers(c.id)}>
            <rect
              className="wheel-paddle"
              x={c.x - 42} y={c.x < 210 ? 268 : 268} width="84" height="26" rx="9"
            />
            <text className="wheel-tag" x={c.x} y={285}>
              {c.id === 'shift' ? 'SHIFT' : 'CLUTCH'}
            </text>
          </g>
        ))}

        {/* Shift lights */}
        <g className={`wheel-hit${isOn('leds') ? ' is-on' : ''}`} {...handlers('leds')}>
          <rect className="wheel-led-bed" x="128" y="68" width="164" height="20" rx="8" />
          {Array.from({ length: 9 }, (_, i) => (
            <circle
              key={i}
              className={`wheel-led wheel-led-${i < 3 ? 'a' : i < 6 ? 'b' : 'c'}`}
              cx={142 + i * 17} cy="78" r="4.6"
            />
          ))}
        </g>

        {/* Display */}
        <g className={`wheel-hit${isOn('display') ? ' is-on' : ''}`} {...handlers('display')}>
          <rect className="wheel-display" x="132" y="100" width="156" height="94" rx="10" />
          <text className="wheel-gear" x="210" y="152">6</text>
          <text className="wheel-readout" x="210" y="176">1:18.412</text>
        </g>

        {rotaries.map((c) => {
          // The upper pair label above themselves and the lower pair
          // below, so a caption never lands on the dial beneath it.
          const above = c.y < 140;
          return (
            <g key={c.id} className={`wheel-hit${isOn(c.id) ? ' is-on' : ''}`} {...handlers(c.id)}>
              <circle className="wheel-rotary" cx={c.x} cy={c.y} r={ROTARY_R} />
              <line
                className="wheel-pointer"
                x1={c.x} y1={c.y} x2={c.x + 13} y2={c.y - 15}
              />
              <text
                className="wheel-tag"
                x={c.x}
                y={above ? c.y - ROTARY_R - 8 : c.y + ROTARY_R + 15}
              >
                {c.label}
              </text>
            </g>
          );
        })}

        {buttons.map((c) => (
          <g key={c.id} className={`wheel-hit${isOn(c.id) ? ' is-on' : ''}`} {...handlers(c.id)}>
            <circle className="wheel-button" cx={c.x} cy={c.y} r={BUTTON_R} />
            <text className="wheel-tag wheel-tag-sm" x={c.x} y={c.y + 4}>{c.label}</text>
          </g>
        ))}
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
