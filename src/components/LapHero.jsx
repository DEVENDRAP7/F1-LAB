import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadSeason, loadTelemetry } from '../lib/published.js';
import { loadManifest, loadRacingLine } from '../lib/racingLine.js';
import { decodeLapPath, SPEED_BAND_EDGES, VERTICAL_EXAGGERATION } from '../lib/lapTerrain.js';
import { Method } from './Disclosure.jsx';
import { formatLapTime } from '../lib/formatTime.js';

/* The landing page's subject: one real lap, in three dimensions.
 *
 * The site draws x and y on six pages and throws the z channel away on
 * all of them. It is published, it is real, and at Spa it is 102 m —
 * so this is the one view that shows it, and the reason the landing
 * page is 3D rather than decorated.
 *
 * Three things this component is careful about.
 *
 * PAYLOAD. docs/SPEC.md budgets the initial load at 400 KB transferred,
 * and three.js is 505 KB raw. So the library is reached by a dynamic
 * import after this component has mounted and painted: it lands in its
 * own chunk which nothing blocks on, and the page is readable before it
 * arrives and still readable if it never does.
 *
 * Measured on the built site against a gzipping server: 367 KB over 12
 * requests, of which 125 KB is three.js and 42 KB is the lap itself.
 * Inside the budget, but not by much, which is why the round picker
 * fetches one manifest rather than all thirteen — that alone was twelve
 * requests — and why the hero draws one lap rather than a grid of them.
 *
 * LAYOUT SHIFT. The frame is given its height by CSS before anything is
 * fetched, and the canvas mounts inside that same frame. A first mount
 * in its final place is not a shift; only a move is. This is why the
 * status line lives INSIDE the frame rather than above it — a line of
 * text that is later replaced by a 460 px canvas is how three other
 * pages on this site once scored 0.5 on CLS.
 *
 * REFUSAL. Not every lap has a usable elevation channel — on some the
 * feed published a constant, or noise inside a couple of metres, and
 * derive_telemetry.py records that judgement in the manifest. Those
 * rounds are not offered, and the count of them is read off the
 * manifests rather than written down, because it changes with the data.
 * Drawing one would mean either a flat lap pretending to be a
 * measurement or an invented hill, and the project's first ground rule
 * rules out both.
 */

// Elevation is the subject, so the round list is the set of laps that
// have one. Built from the manifests at load time rather than written
// down here: a hardcoded list would be wrong after the next refresh.
const SESSION = 'Q';

/* One label per band, built from the edges rather than typed out, so the
 * legend cannot come to disagree with the colours it is labelling. Only
 * the top band carries the unit: repeating "km/h" five times is four
 * more than a reader needs. */
const SPEED_BAND_LABELS = SPEED_BAND_EDGES.map((edge, i) =>
  i === 0 ? `<${edge}` : `${SPEED_BAND_EDGES[i - 1]}-${edge}`,
).concat(`${SPEED_BAND_EDGES[SPEED_BAND_EDGES.length - 1]}+ km/h`);

/* Which rounds can be drawn, from the index rather than by probing.
 *
 * The index carries each session's elevation verdict precisely so this
 * question can be answered in one request. An earlier version of this
 * hook fetched all thirteen session manifests to read their elevation
 * fields — thirteen round trips to decide what to offer, which is the
 * probing telemetry.json was written to end. The chosen round's manifest
 * is still fetched, because decoding its .bin needs the channel order,
 * the divisors and the point count, and none of those are ever guessed. */
function useLapRounds() {
  const [rounds, setRounds] = useState(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadSeason(), loadTelemetry()])
      .then(([calendar, telemetry]) => {
        if (cancelled) return;
        const byRound = new Map((calendar.calendar ?? []).map((r) => [String(r.round), r]));

        const usable = [];
        let refused = 0;
        for (const [round, sessions] of Object.entries(telemetry.rounds ?? {})) {
          const session = sessions?.[SESSION];
          if (!session || (session.drivers?.length ?? 0) === 0) continue;
          // A session with no elevation field at all was exported before
          // the pipeline made that judgement; it is not a refusal, and
          // it is not drawable either, so it is passed over silently
          // rather than counted as one.
          if (!session.elevation) continue;
          if (!session.elevation.usable) {
            refused += 1;
            continue;
          }
          usable.push({
            round: Number(round),
            circuitName: byRound.get(round)?.circuitName ?? `Round ${round}`,
            elevation: session.elevation,
          });
        }
        usable.sort((a, b) => a.round - b.round);
        setRounds({ usable, refused });
      })
      .catch(() => {
        if (!cancelled) setRounds({ usable: [], refused: 0 });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return rounds;
}

export default function LapHero() {
  const rounds = useLapRounds();
  const [pick, setPick] = useState(null);
  const [lap, setLap] = useState(null);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const sceneRef = useRef(null);

  // The most recent lap available, until a reader chooses otherwise.
  // This is a season site: the newest round is the one worth opening on.
  const current = useMemo(() => {
    if (!rounds?.usable.length) return null;
    const wanted = pick ?? rounds.usable[rounds.usable.length - 1].round;
    return rounds.usable.find((r) => r.round === wanted) ?? null;
  }, [rounds, pick]);

  // Decode the chosen lap.
  useEffect(() => {
    if (!current) return undefined;
    let cancelled = false;
    setLap(null);
    setError(null);

    const { round } = current;

    loadManifest(round, SESSION)
      .then(async (manifest) => {
        if (cancelled) return;
        // The quickest of the exported laps. The manifest's `laps` is
        // ordered by lap time, and the code is read from it rather than
        // from the driver map, whose key order means nothing.
        const entry = manifest.laps?.[0];
        const code = entry?.code ?? Object.keys(manifest.drivers ?? {})[0];
        if (!code) throw new Error('this session published no lap to draw');

        const channels = await loadRacingLine(round, SESSION, code, manifest);
        if (cancelled) return;
        const path = decodeLapPath(channels, manifest.scale);
        if (!path.count) throw new Error('the position channel for this lap is empty');
        setLap({ path, code, lapTimeS: entry?.lapTimeS ?? null });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [current]);

  // Mount the scene. three.js is imported here, and only here, so it
  // stays out of the initial bundle.
  useEffect(() => {
    if (!lap || !canvasRef.current) return undefined;
    let cancelled = false;
    let scene = null;

    import('../lib/lapSceneThree.js')
      .then(({ createLapScene }) => {
        if (cancelled || !canvasRef.current) return;
        scene = createLapScene(canvasRef.current, lap.path);
        sceneRef.current = scene;
      })
      .catch(() => {
        // WebGL missing, or the chunk failed to arrive. Either way the
        // frame keeps its size and says what happened rather than
        // leaving a hole.
        if (!cancelled) setError('this browser could not open a 3D context');
      });

    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [lap]);

  // Stop rendering while scrolled away. This is the first thing on the
  // page and the last thing that should still be spending a phone's
  // battery once a reader is three panels down.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => sceneRef.current?.setRunning(entry.isIntersecting),
      { threshold: 0.01 },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Follow a theme change: the scene's colours are read from tokens.css
  // once, at build time of its buffers.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => sceneRef.current?.setPalette();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const relief = current?.elevation?.rangeM;
  const status = error ?? (!rounds ? 'reading the season' : !lap ? 'decoding the lap' : null);

  return (
    <section className="lap-hero">
      <div className="lap-hero-frame" ref={frameRef}>
        {lap && !error && (
          <canvas
            ref={canvasRef}
            className="lap-hero-canvas"
            aria-label={
              `The fastest qualifying lap of round ${current.round} at ${current.circuitName}, ` +
              `drawn in three dimensions from published position data. Drag to orbit. ` +
              `Elevation range ${relief} metres, drawn at ${VERTICAL_EXAGGERATION} times vertical scale.`
            }
          />
        )}
        {status && <p className="lap-hero-status mono">{status}</p>}

        {/* Always rendered, even before there is anything to put in it.
            On a phone this plate sits BELOW the canvas rather than over
            it — at 390px the two cannot share a frame, and overlaid it
            covered the lower half of the lap — which means its height is
            part of the page's layout, and a plate that appeared once the
            season index landed would push everything below it down. So
            it holds its space from the first paint and fills in. */}
        <div className="lap-hero-plate" aria-live="polite">
          <p className="lap-hero-round mono">
            {current ? `Round ${current.round}` : '\u00a0'}
          </p>
          <h2 className="lap-hero-circuit">{current?.circuitName ?? '\u00a0'}</h2>
          <p className="lap-hero-lap mono">
            {lap ? (
              <>
                {lap.code}
                {lap.lapTimeS != null && ` · ${formatLapTime(lap.lapTimeS)}`}
                {relief != null && ` · ${relief} m of elevation`}
              </>
            ) : (
              '\u00a0'
            )}
          </p>
        </div>

        {lap && !error && (
          <ul className="lap-hero-legend" aria-label="Speed">
            {SPEED_BAND_LABELS.map((label, i) => (
              <li key={label}>
                <span className="lap-hero-swatch" style={{ background: `var(--grip-${i + 1})` }} />
                <span className="mono">{label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rounds?.usable.length > 1 && (
        <div className="lap-hero-rounds" role="group" aria-label="Round">
          {rounds.usable.map((r) => (
            <button
              type="button"
              key={r.round}
              className={`lap-hero-round-chip mono${r.round === current?.round ? ' is-on' : ''}`}
              aria-pressed={r.round === current?.round}
              onClick={() => setPick(r.round)}
              title={`${r.circuitName} — ${r.elevation.rangeM} m`}
            >
              {r.round}
            </button>
          ))}
        </div>
      )}

      <Method label="What is measured here, and what is drawn">
        <p>
          The line is one lap&apos;s published position trace: x, y and the z channel the rest of
          the site discards. Colour is the speed at that sample, on the same bands as{' '}
          <Link to="/racing-lines">Racing Lines</Link>. The sheet beneath the line is the
          height above the lowest point of this lap.
        </p>
        <p>
          Height is drawn at <strong>{VERTICAL_EXAGGERATION}× vertical scale</strong> — one
          factor for every circuit, so relief stays true relative to itself — this lap&apos;s{' '}
          {relief} m against its own horizontal span, and a flatter circuit drawn flatter.
          Fitting each circuit to the same screen height would draw Monza as hilly as Spa.
        </p>
        <p>
          The line&apos;s thickness is a drawn weight, not a track width: the feed publishes a
          driven line, not a road. Elevation is relative to the feed&apos;s own datum rather than
          to sea level, so the floor is this lap&apos;s low point and is never labelled an
          altitude.
        </p>
        {rounds?.refused > 0 && (
          <p>
            {rounds.refused === 1 ? 'One round is' : `${rounds.refused} rounds are`} absent: their
            elevation channel did not vary enough to be elevation, and the pipeline refused it.
            See <Link to="/refusals">Refusals</Link>.
          </p>
        )}
      </Method>
    </section>
  );
}
