import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUTTONS, CONTROL_KIND, FIXTURES, IDLE_RPM, REV_LIMIT, ROTARIES,
  RPM_AFTER_DOWNSHIFT, RPM_AFTER_UPSHIFT, STATUS_LAMPS,
  atRevLimit, describe, initialPositions, lampTone, litLamps, manualRpm,
} from '../lib/steeringWheel.js';
import { DEMOS, stateAt } from '../lib/wheelDemo.js';
import EngineAudio, { VOICES } from '../lib/engineAudio.js';

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

// Eighth is the top of the box and first is the bottom of it; neutral is
// not below first, it is off to one side, which is exactly why a real
// car needs a separate button for it and why the down paddle stops at 1.
const TOP_GEAR = 8;

// What the display shows for speed when the wheel is being worked by
// hand rather than by a demo. Indicative, and the panel says so: no
// team publishes a ratio set, so there is no true answer to look up.
const GEAR_KPH = [0, 92, 138, 186, 236, 278, 308, 328, 342];

// The screen and the shift strip share a width, and it is as wide as
// the face allows. The binding constraints are the inner edge of each
// button column (the radio button's rim reaches x 324) and the rounded
// end of each raised pod, whose centre sits at x 286 with a radius of
// 44 — so a bed corner at x 332 clears it by 3.6 units and one at 330
// does not. Everything below is measured off those two numbers.
const SCREEN_X = 332;
const SCREEN_W = 236;
const SCREEN_Y = 144;
const SCREEN_H = 178;
// Text insets, and the right edge that every right-aligned field ends on.
const PAD_L = SCREEN_X + 14;
const PAD_R = SCREEN_X + SCREEN_W - 14;
const LED_N = 13;

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

export default function SteeringWheel({ mode, onMode }) {
  const [positions, setPositions] = useState(initialPositions);
  const [pressed, setPressed] = useState({});
  const [pinned, setPinned] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [gear, setGear] = useState(4);
  const [speed, setSpeed] = useState(GEAR_KPH[4]);
  const [demo, setDemo] = useState(null);
  const [caption, setCaption] = useState(null);
  const [sound, setSound] = useState(true);
  const [voice, setVoice] = useState('v6');
  const [rpm, setRpm] = useState(RPM_AFTER_UPSHIFT);
  // Where the next rev ramp starts from. A ref, not state, because the
  // ramp effect reads it once when it starts and must not restart when
  // it changes.
  const rpmFrom = useRef(RPM_AFTER_UPSHIFT);
  const audio = useRef(null);

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

  const lit = litLamps(rpm, LED_N);
  const lampOn = {
    limiter: !!pressed.limiter,
    override: !!pressed.override,
    aero: !!pressed.aero,
    neutral: gear === 0,
  };

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

  const shift = (step) => setGear((g) => {
    const next = Math.min(TOP_GEAR, Math.max(1, g + step));
    if (next === g) return g;
    setSpeed(GEAR_KPH[next]);
    // Revs drop on an upshift and rise on a downshift. It is the whole
    // shape of a shift, and it is what makes the strip empty and fill.
    rpmFrom.current = step > 0 ? RPM_AFTER_UPSHIFT : RPM_AFTER_DOWNSHIFT;
    setRpm(rpmFrom.current);
    return next;
  });

  const selectNeutral = () => {
    setGear(0);
    setSpeed(0);
    rpmFrom.current = IDLE_RPM;
    setRpm(IDLE_RPM);
  };

  const stopDemo = useCallback(() => {
    setDemo(null);
    setCaption(null);
    audio.current?.stop();
  }, []);

  // One animation frame at a time, the demo is sampled and its state
  // pushed into the wheel — the same state a person sets by hand, so
  // there is no second code path for "playing" versus "being used".
  useEffect(() => {
    if (!demo) return undefined;
    const script = DEMOS.find((d) => d.id === demo);
    const started = performance.now();
    let raf = 0;
    let done = false;

    const tick = (now) => {
      const t = (now - started) / 1000;
      const s = stateAt(script, t);
      setGear(s.gear);
      setSpeed(Math.round(s.speed));
      setRpm(s.rpm);
      rpmFrom.current = s.rpm;
      setCaption(s.caption);
      setPositions((p) => (p.strategy === s.strategy && p.engine === s.engine
        ? p : { ...p, strategy: s.strategy, engine: s.engine }));
      setPressed((p) => (!!p.override === !!s.override && !!p.aero === (s.mode === 'X')
        ? p : { ...p, override: !!s.override, aero: s.mode === 'X' }));
      onMode?.(s.mode);
      audio.current?.set(s.rpm, s.throttle);
      if (t >= script.duration) {
        if (!done) { done = true; stopDemo(); }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [demo, onMode, stopDemo]);

  // Audio lives in its own effect, and `sound` is deliberately NOT a
  // dependency of the one above: with it there, un-ticking the sound
  // box tore down the loop and restarted the sequence from zero.
  // set() is a no-op while the graph is down, so the demo does not care
  // either way.
  useEffect(() => {
    if (demo && sound) {
      audio.current ??= new EngineAudio();
      audio.current.start(VOICES[voice]);
    } else {
      audio.current?.stop();
    }
  }, [demo, sound, voice]);

  // Leaving the page with an engine still running would be unforgivable.
  useEffect(() => () => audio.current?.stop(), []);

  // Outside a demo the car is taken to be accelerating in the selected
  // gear, so the revs climb and the strip fills — a shift strip that
  // never moves is not a shift strip, it is thirteen painted circles.
  //
  // The loop is BOUNDED: it ends the moment the revs reach the limiter,
  // about two seconds after a shift, and the flashing at the limit is a
  // CSS animation rather than a frame loop. A permanent requestAnimation
  // Frame for an ornament is not worth anybody's battery.
  useEffect(() => {
    if (demo) return undefined;
    if (gear === 0) return undefined;
    const from = rpmFrom.current;
    const started = performance.now();
    let raf = 0;
    const tick = (now) => {
      const { rpm: next, done } = manualRpm(from, (now - started) / 1000);
      setRpm(next);
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [demo, gear]);

  // The page has its own Z/X switch above the car. If someone uses it,
  // the wheel's AERO button has to follow, or the two disagree about
  // the state of the same car.
  useEffect(() => {
    setPressed((p) => (!!p.aero === (mode === 'X') ? p : { ...p, aero: mode === 'X' }));
  }, [mode]);

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
        {/* Each tab is its own control now, not two halves of one hit
            target: the right shift paddle goes up the box and the left
            one comes down it, which is the whole reason a wheel has two
            of them. Both still describe the same fixture. */}
        {PADDLES.flatMap((p) => p.spans.map(([x, w]) => {
          const up = x > 450;
          const id = `fix:${p.id}`;
          const lx = x + w / 2 + (up ? 12 : -12);
          return (
            <g key={`${p.id}${x}`}
              className={`wheel-hit${shown === id ? ' is-on' : ''}`}
              {...activate(id, p.id === 'shift' ? () => shift(up ? 1 : -1) : () => {})}
            >
              <rect className="wheel-paddle" x={x} y={p.y} width={w} height={p.h} rx="14" />
              {/* Nudged outward onto the exposed half of the tab. Centred,
                  the label sat exactly on the face edge that overlaps it
                  and half of every word disappeared behind the wheel. */}
              <text
                className="wheel-tag wheel-tag-sm"
                x={lx} y={p.y + p.h / 2 + 4}
                transform={`rotate(-90 ${lx} ${p.y + p.h / 2})`}
              >
                {p.id === 'shift' ? (up ? 'UP' : 'DOWN') : p.label}
              </text>
            </g>
          );
        }))}

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
          <rect className="wheel-screen-bed" x={SCREEN_X} y="112" width={SCREEN_W} height="26" rx="10" />
          <g className={`wheel-leds${atRevLimit(rpm) ? ' at-limit' : ''}`}>
            {Array.from({ length: LED_N }, (_, i) => (
              <circle
                key={i}
                className={`wheel-led wheel-led-${lampTone(i, LED_N)}`
                  + `${i < lit ? ' is-lit' : ''}`}
                cx={SCREEN_X + 16 + i * 17} cy="125" r="5.4"
              />
            ))}
          </g>
        </g>

        {/* Status columns either side of the screen, in the one strip of
            face left between the button columns and the display. Real
            wheels carry these where a driver can catch them without
            leaving the road in their peripheral vision — which is also
            why there are two of them and they say the same thing.
            Each lamp reports a state you can actually put this wheel
            into, rather than standing for something a team's telemetry
            might show, which would be an invention dressed as a fact. */}
        {[315, 585].map((x) => (
          <g key={x}
            className={`wheel-hit${shown === 'fix:status' ? ' is-on' : ''}`}
            {...activate('fix:status', () => {})}
          >
            {STATUS_LAMPS.map((lamp, i) => (
              <circle
                key={lamp.id}
                className={`wheel-led wheel-led-${lamp.tone}${lampOn[lamp.id] ? ' is-lit' : ''}`}
                cx={x} cy={180 + i * 26} r="4.6"
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
              text fell off the bottom of the screen entirely.
           *
           *  Every field is a dim three-letter caption and a bright
           *  value, which is how a real dash separates what a number is
           *  from what it says. One flat colour for the whole string
           *  made the caption compete with the reading. */}
          <rect className="wheel-screen-bed" x={SCREEN_X} y={SCREEN_Y}
            width={SCREEN_W} height={SCREEN_H} rx="12" />
          {/* An inner bezel, inset from the bed: a screen is recessed
              into its housing and the step is what shows that. */}
          <rect className="wheel-screen-rim" x={SCREEN_X + 5} y={SCREEN_Y + 5}
            width={SCREEN_W - 10} height={SCREEN_H - 10} rx="8" />
          <rect className="wheel-screen-glow" x={SCREEN_X} y={SCREEN_Y}
            width={SCREEN_W} height={SCREEN_H} rx="12" />

          <text className="wheel-lcd-val" x={PAD_L} y="174">
            <tspan className="wheel-lcd-cap">SPD </tspan>{speed}
          </text>
          {/* No caption on the time, and the arithmetic is the reason.
              The band is 208 units wide; at the size a phone needs, a
              "LAP " prefix takes the two fields to 217 and they overlap.
              m:ss.mmm does not need telling what it is. */}
          <text className="wheel-lcd-val wheel-right" x={PAD_R} y="174">1:18.412</text>

          {/* Neutral is a letter, not a number, and it is the one
              reading a driver checks before letting the clutch out. */}
          <text className={`wheel-gear${gear === 0 ? ' is-neutral' : ''}`} x="450" y="250">
            {gear === 0 ? 'N' : gear}
          </text>

          {/* A rule under the gear band. Without it the modes read as a
              continuation of one tall column of numbers. */}
          <line className="wheel-lcd-rule" x1={PAD_L} x2={PAD_R} y1="262" y2="262" />

          <text className="wheel-lcd-row" x={PAD_L} y="284">
            <tspan className="wheel-lcd-cap">ENG </tspan>{readout.engine}
          </text>
          <text className="wheel-lcd-row wheel-right" x={PAD_R} y="284">
            <tspan className="wheel-lcd-cap">STR </tspan>{readout.strategy}
          </text>
          <text className="wheel-lcd-row" x={PAD_L} y="308">
            <tspan className="wheel-lcd-cap">ENB </tspan>{readout.braking}
          </text>
          <text className="wheel-lcd-row wheel-right" x={PAD_R} y="308">
            <tspan className="wheel-lcd-cap">AERO </tspan>{pressed.aero ? 'X' : 'Z'}
          </text>
          {/* The bar fills with the engine map, so the screen carries a
              reading you can take in without parsing any text. */}
          <rect className="wheel-bar-bed" x={PAD_L} y="311" width={PAD_R - PAD_L}
            height="8" rx="4" />
          <rect
            className="wheel-bar-fill" x={PAD_L} y="311" rx="4" height="8"
            width={(PAD_R - PAD_L) * ((positions.engine + 1) / ROTARIES[0].positions.length)}
          />
        </g>

        {/* Buttons */}
        {BUTTONS.map((b) => {
          const on = pressed[b.id];
          const id = `btn:${b.id}`;
          return (
            <g key={b.id}
              className={`wheel-hit${shown === id ? ' is-on' : ''}${on ? ' is-lit' : ''}`}
              {...activate(id, () => {
                if (b.id === 'neutral') { selectNeutral(); return; }
                if (b.id === 'aero') onMode?.(pressed.aero ? 'Z' : 'X');
                press(b.id);
              })}
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

      <div className="wheel-demo">
        <div className="wheel-demo-bar">
          <span className="wheel-demo-label mono">Run a sequence</span>
          {DEMOS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`wheel-demo-button${demo === d.id ? ' is-on' : ''}`}
              onClick={() => (demo === d.id ? stopDemo() : setDemo(d.id))}
              title={d.blurb}
            >
              {demo === d.id ? `Stop · ${d.name}` : d.name}
            </button>
          ))}
          <label className="wheel-sound">
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => setSound(e.target.checked)}
            />
            Engine sound
          </label>
          <label className="wheel-sound wheel-voice">
            <select
              aria-label="Engine"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            >
              {Object.values(VOICES).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="wheel-voice-note">{VOICES[voice].note}</p>
        {caption
          ? <p className="wheel-caption" aria-live="polite">{caption}</p>
          : (
            <p className="wheel-demo-note">
              The sequences drive this wheel and the car above it — gears, modes, the
              override and the wings. The engine is synthesised in the browser from an
              oscillator stack, not a recording: a real one would be somebody&rsquo;s
              copyright and would cost more than this whole page&rsquo;s payload budget.
              Speeds, revs and shift points are illustrative, not measured — no team
              publishes a ratio set, a shift point or what a deployment mode is worth.
            </p>
          )}
      </div>
    </div>
  );
}

export { FIXTURES };
