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
//
// ── on the draw order ────────────────────────────────────────────────
// It is not decorative. Paddles first, because they are BEHIND the
// wheel and the grips have to pass in front of them; then the grips;
// then the lower panel, which runs up under the face so the two read as
// one moulding rather than two boards with a gap; then the face; then
// the pods, which are raised off the face and were previously drawn
// underneath it, where they were invisible and contributed nothing.

const RING_IN = 44;
const RING_OUT = 70;

// Declared once: the sheen is the same outline as the face, laid over it.
//
// The top edge is not straight. Real wheels carry the outer top corners
// up into horns and dip away between them, which is most of what makes
// the silhouette recognisable — a plain rounded rectangle reads as a
// tablet with switches on it.
const FACE_PATH = 'M212 88 L272 88 L318 108 L582 108 L628 88 L718 88 '
  + 'A26 26 0 0 1 744 114 L744 332 A26 26 0 0 1 718 358 L212 358 '
  + 'A26 26 0 0 1 186 332 L186 114 A26 26 0 0 1 212 88 Z';

// Shift above, clutch below, one of each on both sides — four paddles,
// two functions, which is what the cars carry. Both tabs of a pair are
// the same hit target, so hovering either explains the same control.
const PADDLES = [
  { id: 'shift', label: 'SHIFT', y: 168, h: 76, spans: [[124, 66], [710, 66]] },
  { id: 'clutch', label: 'CLUTCH', y: 254, h: 58, spans: [[132, 58], [710, 58]] },
];

// The screen and the shift strip share a width, and it is narrower than
// it was: the raised pods have to clear it, and at the old width the
// left pod covered the display's top corner.
const SCREEN_X = 336;
const SCREEN_W = 228;
const STRIP_X = 352;
const STRIP_W = 196;
const LED_N = 11;

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
          {/* Carbon weave. A twill is two sets of diagonals at opposite
              angles, one catching light and one in shadow — which is why
              a flat grey fill never reads as carbon however dark it is.
              The colours are the wheel's own, not the page's: in the
              light theme the site's surface tokens made this white. */}
          <pattern id="carbon" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="var(--wh-2)" />
            <path
              d="M0 10 L10 0 M-3 3 L3 -3 M7 13 L13 7"
              stroke="var(--wh-3)" strokeWidth="2.4" opacity="0.55"
            />
            <path
              d="M0 0 L10 10 M-3 7 L3 13 M7 -3 L13 3"
              stroke="var(--wh-0)" strokeWidth="1.7" opacity="0.5"
            />
          </pattern>
          {/* A sheen across the top third, so the face reads as a surface
              turned to the light rather than a flat cut-out. */}
          <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.11" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.02" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.16" />
          </linearGradient>
          <linearGradient id="wheelGrip" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--wh-3)" />
            <stop offset="0.5" stopColor="var(--wh-2)" />
            <stop offset="1" stopColor="var(--wh-0)" />
          </linearGradient>
          {/* Knobs are machined metal: lit from the upper left, falling
              away to shadow at the lower right. */}
          <radialGradient id="knobFace" cx="0.34" cy="0.28" r="0.9">
            <stop offset="0" stopColor="var(--wh-edge)" />
            <stop offset="0.55" stopColor="var(--wh-2)" />
            <stop offset="1" stopColor="var(--wh-0)" />
          </radialGradient>
          <radialGradient id="btnGloss" cx="0.35" cy="0.28" r="0.75">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.34" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="screenGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--wh-lcd)" stopOpacity="0.10" />
            <stop offset="1" stopColor="var(--wh-lcd)" stopOpacity="0" />
          </linearGradient>
          <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#000" floodOpacity="0.5" />
          </filter>
        </defs>

        {/* Paddles. Behind everything, tucked under the outer edges. */}
        {PADDLES.map((p) => (
          <g key={p.id}
            className={`wheel-hit${shown === `fix:${p.id}` ? ' is-on' : ''}`}
            {...activate(`fix:${p.id}`, () => {})}
          >
            {p.spans.map(([x, w]) => (
              <g key={x}>
                <rect className="wheel-paddle" x={x} y={p.y} width={w} height={p.h} rx="14" />
                {/* Nudged outward onto the exposed half of the tab. Centred,
                    the label sat exactly on the face edge that overlaps it
                    and half of every word disappeared behind the wheel. */}
                <text
                  className="wheel-tag wheel-tag-sm"
                  x={x + w / 2 + (x < 450 ? -12 : 12)} y={p.y + p.h / 2 + 4}
                  transform={`rotate(-90 ${x + w / 2 + (x < 450 ? -12 : 12)} ${p.y + p.h / 2})`}
                >
                  {p.label}
                </text>
              </g>
            ))}
          </g>
        ))}

        {/* Grips. These are the wheel's dominant feature — big sculpted
            hooks sweeping down and outward, then tucking back in under
            the panel. Drawn thin, they read as a bracket around a
            tablet; drawn without the hook, as two hanging legs. */}
        <path className="wheel-grip" d="M272 316 C 176 344 122 424 128 508 C 132 548 164 570 204 572" />
        <path className="wheel-grip" d="M628 316 C 724 344 778 424 772 508 C 768 548 736 570 696 572" />
        <path className="wheel-grip-hollow" d="M292 348 C 214 378 164 442 170 506 C 174 542 196 558 226 560" />
        <path className="wheel-grip-hollow" d="M608 348 C 686 378 736 442 730 506 C 726 542 704 558 674 560" />

        {/* Lower panel, running up under the face. */}
        <rect className="wheel-panel" x="212" y="330" width="476" height="246" rx="20" />
        <rect className="wheel-sheen" x="212" y="330" width="476" height="246" rx="20" />

        {/* Upper face, then the same outline again as a light pass */}
        <path className="wheel-face" d={FACE_PATH} />
        <path className="wheel-sheen" d={FACE_PATH} />

        {/* Raised pods at the top corners, which is where the outer
            buttons actually sit — the face is not one flat plane. */}
        <rect className="wheel-pod" x="200" y="112" width="130" height="88" rx="44"
          transform="rotate(-6 265 156)" />
        <rect className="wheel-pod" x="570" y="112" width="130" height="88" rx="44"
          transform="rotate(6 635 156)" />

        {/* Shift lights */}
        <g className={`wheel-hit${shown === 'fix:leds' ? ' is-on' : ''}`}
          {...activate('fix:leds', () => {})}
        >
          <rect className="wheel-screen-bed" x={STRIP_X} y="112" width={STRIP_W} height="26" rx="10" />
          {Array.from({ length: LED_N }, (_, i) => (
            <circle
              key={i}
              className={`wheel-led wheel-led-${i < 4 ? 'a' : i < 8 ? 'b' : 'c'}`}
              cx={365 + i * 17} cy="125" r="5.2"
            />
          ))}
        </g>

        {/* Status columns either side of the screen, in the one strip of
            face left between the button columns and the display. Real
            wheels carry these where a driver can catch them without
            leaving the road in their peripheral vision. */}
        {[315, 585].map((x) => (
          <g key={x}>
            {[180, 206, 232, 258].map((y, i) => (
              <circle
                key={y}
                className={`wheel-led wheel-led-${i === 0 ? 'a' : i === 3 ? 'c' : 'b'}`}
                cx={x} cy={y} r="4.2" opacity={i === 3 ? 0.35 : 0.9}
              />
            ))}
          </g>
        ))}

        {/* Display — it reports the switch positions below it */}
        <g className={`wheel-hit${shown === 'fix:display' ? ' is-on' : ''}`}
          {...activate('fix:display', () => {})}
        >
          {/* Laid out in three bands — a small top line, the gear on its
              own, then the modes — because a 52px digit centred across a
              line of 20px values collides with them, and a fourth row of
              text fell off the bottom of the screen entirely. */}
          <rect className="wheel-screen-bed" x={SCREEN_X} y="146" width={SCREEN_W} height="154" rx="12" />
          <rect className="wheel-screen-glow" x={SCREEN_X} y="146" width={SCREEN_W} height="154" rx="12" />
          <text className="wheel-lcd-sm" x="352" y="170">SPD 298</text>
          <text className="wheel-lcd-sm wheel-right" x="548" y="170">1:18.412</text>
          <text className="wheel-gear" x="450" y="226">8</text>
          <text className="wheel-lcd-row" x="352" y="258">{`ENG ${readout.engine}`}</text>
          <text className="wheel-lcd-row wheel-right" x="548" y="258">
            {`STR ${readout.strategy}`}
          </text>
          <text className="wheel-lcd-row" x="352" y="284">{`ENB ${readout.braking}`}</text>
          <text className="wheel-lcd-row wheel-right" x="548" y="284">
            {pressed.aero ? 'AERO X' : 'AERO Z'}
          </text>
          {/* The bar fills with the engine map, so the screen carries a
              reading you can take in without parsing any text. */}
          <rect className="wheel-bar-bed" x={STRIP_X} y="290" width={STRIP_W} height="7" rx="3.5" />
          <rect
            className="wheel-bar-fill" x={STRIP_X} y="290" rx="3.5" height="7"
            width={STRIP_W * ((positions.engine + 1) / ROTARIES[0].positions.length)}
          />
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
              {b.kind === 'rocker' ? (
                <>
                  <rect
                    className={`wheel-button tone-${b.tone}`}
                    x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx="7"
                  />
                  {/* Ribs: these are thumbed blind at speed, so the real
                      ones are deeply serrated to be found by feel. */}
                  {Array.from({ length: 6 }, (_, i) => (
                    <line
                      key={i} className="wheel-rib"
                      x1={b.x - b.w / 2 + 4} x2={b.x + b.w / 2 - 4}
                      y1={b.y - b.h / 2 + 9 + i * 9} y2={b.y - b.h / 2 + 9 + i * 9}
                    />
                  ))}
                  <rect
                    className="wheel-gloss"
                    x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx="7"
                  />
                </>
              ) : (
                <>
                  <circle className={`wheel-button tone-${b.tone}`} cx={b.x} cy={b.y} r={b.r} />
                  <circle className="wheel-gloss" cx={b.x} cy={b.y} r={b.r} />
                </>
              )}
              <text
                className={`wheel-btn-label${b.kind === 'rocker' ? ' wheel-tag-sm' : ''}`}
                x={b.x} y={b.kind === 'rocker' ? b.y + b.h / 2 + 16 : b.y + 5}
              >
                {b.label}
              </text>
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
                <circle className="wheel-gloss" cx={rot.cx} cy={rot.cy} r={RING_IN - 5} />
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
