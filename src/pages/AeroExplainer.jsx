import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import { loadManifest, loadRacingLine } from '../lib/racingLine.js';
import {
  accelerationTrace,
  lateralEnvelope,
  peaks,
  CURVATURE_MIN_HALF_WINDOW_M,
  PEAK_PERCENTILE,
} from '../lib/aero.js';
import { seriesColor } from '../theme/palette.js';
import EmptyState from '../components/EmptyState.jsx';
import GGDiagram from '../components/GGDiagram.jsx';
import EnvelopeChart from '../components/EnvelopeChart.jsx';
import GripMap from '../components/GripMap.jsx';

// M8 — Aero Explainer, the measurable half.
//
// Everything on this page is geometry and speed: lateral acceleration is
// v² times path curvature, longitudinal is v·dv/ds, both from the
// position trace the pipeline already publishes. Those are facts about
// the lap.
//
// What is NOT here is the half that would need constants this project
// cannot verify. Downforce in newtons, C_dA, an efficiency ratio — each
// needs mass, air density and frontal area, none of which any source
// here publishes. The 2026 active-aero and power-unit rules would need
// config/regulations_2026.json checked against the published FIA
// technical regulations, and filling those numbers from memory is
// exactly what this project refuses to do. So the page shows the
// relationship that IS measurable — how much lateral g the car actually
// sustained at each speed — and names the rest as absent.

// A scatter puts every series beside every other, so the colour floors
// are checked all-pairs rather than adjacent-only. Only the first three
// categorical slots clear that, so three is the cap here — a colour
// constraint, not a layout one.
const MAX_COMPARE = 3;

export default function AeroExplainer() {
  const [season, setSeason] = useState({ status: 'loading', data: null });
  const [round, setRound] = useState('');
  const [manifest, setManifest] = useState({ status: 'idle', data: null });
  const [selected, setSelected] = useState([]);
  const [lines, setLines] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setSeason({ status: 'ready', data }))
      .catch(() => !cancelled && setSeason({ status: 'empty', data: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Open on the newest round that has position data exported.
  useEffect(() => {
    if (season.status !== 'ready' || round) return undefined;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    const candidates = season.data.calendar
      .filter((r) => r.date <= today)
      .map((r) => r.round)
      .reverse();

    (async () => {
      for (const candidate of candidates) {
        try {
          await loadManifest(candidate, 'R');
          if (!cancelled) setRound(String(candidate));
          return;
        } catch {
          // no lines for this round yet
        }
      }
      if (!cancelled) setManifest({ status: 'empty', data: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [season, round]);

  useEffect(() => {
    if (!round) return undefined;
    let cancelled = false;
    setManifest({ status: 'loading', data: null });
    setLines({});
    setSelected([]);
    loadManifest(round, 'R')
      .then((data) => {
        if (cancelled) return;
        setManifest({ status: 'ready', data });
        setSelected(Object.keys(data.drivers ?? {}).slice(0, MAX_COMPARE));
      })
      .catch(() => !cancelled && setManifest({ status: 'empty', data: null }));
    return () => {
      cancelled = true;
    };
  }, [round]);

  useEffect(() => {
    if (manifest.status !== 'ready') return;
    let cancelled = false;
    const missing = selected.filter((code) => !(code in lines));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((code) =>
        loadRacingLine(round, 'R', code, manifest.data).then((ch) => [code, ch]),
      ),
    )
      .then((entries) => {
        if (!cancelled) setLines((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [manifest, selected, lines, round]);

  const series = useMemo(() => {
    if (manifest.status !== 'ready') return [];
    const scale = manifest.data.scale;
    return selected
      .filter((code) => lines[code])
      .map((code, i) => {
        const ch = lines[code];
        const trace = accelerationTrace({
          x: Array.from(ch.x, (v) => v / scale.x),
          y: Array.from(ch.y, (v) => v / scale.y),
          speed: Array.from(ch.speed, (v) => v / scale.speed),
        });
        return {
          code,
          color: seriesColor(i),
          trace,
          // The same x/y the trace was computed from, in metres, so the
          // map and the physics can never disagree about where a sample
          // was.
          points: Array.from(ch.x, (v, p) => [v / scale.x, ch.y[p] / scale.y]),
          envelope: lateralEnvelope(trace),
          peaks: peaks(trace),
        };
      });
  }, [manifest, selected, lines]);

  const pastRounds = useMemo(() => {
    if (!season.data) return [];
    const today = new Date().toISOString().slice(0, 10);
    return season.data.calendar.filter((r) => r.date <= today);
  }, [season.data]);

  if (season.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/season.json." />;
  }

  const lap = manifest.data?.laps?.find((l) => l.code === series[0]?.code);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Aero Explainer</h1>
        <p className="page-sub">
          How much acceleration the car actually sustained, and at what speed — measured
          from the driven line, not modelled from assumed constants.
        </p>
      </header>

      <div className="controls-row">
        <label className="field">
          Round{' '}
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="">—</option>
            {pastRounds.map((r) => (
              <option key={r.round} value={r.round}>
                {r.round} · {r.raceName}
              </option>
            ))}
          </select>
        </label>
        {lap && (
          <span className="generated-at mono">
            fastest laps · {manifest.data.source}
          </span>
        )}
      </div>

      {manifest.status === 'loading' && (
        <EmptyState title="Loading lap…" reason="Fetching the position trace for this round." />
      )}

      {manifest.status === 'empty' && (
        <EmptyState
          title="No position data for this round yet"
          reason="The telemetry backfill processes a few rounds per refresh. Pick another round, or wait for the next one."
        />
      )}

      {manifest.status === 'ready' && (
        <>
          <div className="driver-picker">
            {Object.keys(manifest.data.drivers).map((code) => {
              const idx = selected.indexOf(code);
              const on = idx >= 0;
              return (
                <label
                  key={code}
                  className={`driver-chip${on ? ' is-on' : ''}`}
                  style={on ? { borderColor: seriesColor(idx) } : undefined}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && selected.length >= MAX_COMPARE}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                      )
                    }
                  />
                  {on && (
                    <span
                      className="legend-swatch"
                      style={{ background: seriesColor(idx) }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="mono">{code}</span>
                </label>
              );
            })}
          </div>

          {series.length > 0 && (
            <div className="figure-grid">
              {series.map((s) => (
                <div className="figure" key={s.code}>
                  <p className="figure-label">
                    <span className="mono" style={{ color: s.color }}>{s.code}</span> sustained
                    lateral
                  </p>
                  <p className="figure-value mono">{s.peaks.peakLateralG.toFixed(1)}g</p>
                  <p className="figure-sample">
                    braking {s.peaks.peakBrakingG.toFixed(1)}g · top{' '}
                    {Math.round(s.peaks.topSpeedKph)} km/h
                  </p>
                </div>
              ))}
            </div>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Acceleration envelope</h2>
              <p className="panel-note">
                Every sample of the lap, plotted as cornering against braking and
                acceleration. The outline is the limit the car actually operated at.
                Rings are whole g. Lateral is <span className="mono">v² · κ</span> and
                longitudinal is <span className="mono">v · dv/ds</span>, both from the
                position trace and its speed channel.
              </p>
            </div>
            {series.length === 0 ? (
              <p className="panel-note">Select a driver to plot their lap.</p>
            ) : (
              <>
                <GGDiagram series={series} height={480} />
                <div className="chart-legend">
                  {series.map((s) => (
                    <span key={s.code} className="legend-item">
                      <span
                        className="legend-swatch"
                        style={{ background: s.color }}
                        aria-hidden="true"
                      />
                      <span className="mono">{s.code}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Where the load is</h2>
              <p className="panel-note">
                {series[0]?.code ?? 'The'} driven lap, coloured by the lateral g being
                carried at each point of it. The braking zones and the corner apexes are
                not labelled here — they are simply where the colour changes. Colour is
                smoothed over about 20 m of track so a corner reads as a corner; hover
                the line for the unsmoothed figure at a point.
              </p>
            </div>
            {series.length === 0 ? (
              <p className="panel-note">Select a driver to draw their lap.</p>
            ) : (
              <GripMap
                points={series[0].points}
                lateralG={series[0].trace.lateralG}
                speedKph={series[0].trace.speedKph}
                height={520}
              />
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Grip against speed</h2>
              <p className="panel-note">
                The lateral g sustained in each speed band — the 95th percentile of samples
                in that band, so one noisy sample cannot set the line. A car generating
                aerodynamic downforce holds more lateral g as speed rises; a car relying on
                mechanical grip alone would run flat. This shows the shape without
                converting it into a downforce figure, which would need mass, air density
                and frontal area that no source here publishes.
              </p>
            </div>
            {series.length === 0 ? (
              <p className="panel-note">Select a driver to plot their envelope.</p>
            ) : (
              <EnvelopeChart series={series} />
            )}
          </section>

          <section className="panel panel-limitations">
            <div className="panel-head">
              <h2>What this cannot tell you</h2>
            </div>
            <ul className="reason-list">
              <li>
                No downforce in newtons, no <span className="mono">C_dA</span>, no
                efficiency ratio. Each needs mass, air density and frontal area; none is
                published by any source here, and assuming them would turn a measurement
                into a guess wearing a unit.
              </li>
              <li>
                Braking g is total longitudinal deceleration — brakes, engine braking and
                aerodynamic drag together. Nothing in this data separates them, so it is
                never labelled "drag".
              </li>
              <li>
                Curvature is fitted, not differentiated. Position arrives at roughly
                3.7 Hz — more than 20 m between fixes at racing speed — so a curve is
                fitted to a window of the path at least{' '}
                <span className="mono">{CURVATURE_MIN_HALF_WINDOW_M}</span> m either side,
                widened with speed to always span several real fixes. Taken over 2 m
                instead, the same laps read 18–24g, which is several times what any
                Formula 1 car generates: that number was measuring the interpolation, not
                the corner.
              </li>
              <li>
                The headline figures are {Math.round(PEAK_PERCENTILE * 100)}th percentiles
                rather than maxima. A handful of samples per lap still land outside what
                the car could have done, and a maximum would publish one of those as the
                result.
              </li>
              <li>
                The 2026 active-aero and power-unit specifics are absent. They would need{' '}
                <span className="mono">config/regulations_2026.json</span> verified against
                the published FIA technical regulations, and filling those numbers from
                memory is the one thing this project will not do.
              </li>
              <li>
                One flying lap per driver, not a race average. It is that driver's fastest
                non-out lap of the race, on whatever fuel and tyre they were on at the time.
              </li>
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
