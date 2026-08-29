import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import { seriesColor } from '../theme/palette.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import EnvelopeChart from '../components/EnvelopeChart.jsx';
import AeroRigViewport from '../components/AeroRigViewport.jsx';
import { partInfo, VERDICT_LABEL } from '../lib/aeroRigParts.js';
import { relatedLinks } from '../lib/relatedLinks.js';
import { useUrlSelection, useUrlState } from '../lib/urlState.js';

// M9 — Aero Rig. A 3D schematic of the 2026 car, built to the published
// regulation dimensions rather than any team's real bodywork (nobody
// publishes that), wearing numbers pulled from scripts/aero_export.mjs —
// itself arithmetic on the same driven-lap position traces as the Aero
// Explainer page (src/lib/aero.js). The car does not change with the
// round/session/driver picked below: it is one diagram, and only the
// gauges and the envelope chart around it are measured per lap.
//
// Every clickable part carries a verdict — measured, schematic, or
// refused — so the rig never lets its own realism imply more certainty
// than this project actually has about that part.

const MAX_COMPARE = 3;

const MODE_COPY = {
  Z: {
    label: 'Z-mode · loaded',
    text: 'Both wings at their race angle: the load a driver corners with.',
  },
  X: {
    label: 'X-mode · flattened',
    text: 'Both wings flattened for the straight — active aero trading load for top speed.',
  },
};

export default function AeroRig() {
  const [doc, setDoc] = useState({ status: 'loading', data: null });
  const [teamsDoc, setTeamsDoc] = useState({ status: 'loading', data: null });
  const [round, setRound] = useUrlState('round');
  const [session, setSession] = useUrlState('session', 'Q');
  const setSelection = useUrlSelection({ session: 'Q' });
  const [selected, setSelected] = useState([]);
  const [mode, setMode] = useState('Z');
  const [selectedPart, setSelectedPart] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('2026/aero.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setDoc({ status: 'ready', data }))
      .catch(() => !cancelled && setDoc({ status: 'empty', data: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('standings.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setTeamsDoc({ status: data ? 'ready' : 'empty', data }))
      .catch(() => !cancelled && setTeamsDoc({ status: 'empty', data: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Open on the newest round the export actually carries a lap for,
  // preferring qualifying — the highest-load lap of the weekend.
  useEffect(() => {
    if (doc.status !== 'ready' || round) return;
    const sessionsByRound = new Map();
    for (const lap of doc.data.laps) {
      if (!sessionsByRound.has(lap.round)) sessionsByRound.set(lap.round, new Set());
      sessionsByRound.get(lap.round).add(lap.session);
    }
    const newest = [...sessionsByRound.keys()].sort((a, b) => b - a)[0];
    if (newest != null) {
      setSelection({ round: newest, session: sessionsByRound.get(newest).has('Q') ? 'Q' : 'R' });
    }
  }, [doc, round, setSelection]);

  const roundOptions = useMemo(() => {
    if (doc.status !== 'ready') return [];
    const map = new Map();
    for (const lap of doc.data.laps) if (!map.has(lap.round)) map.set(lap.round, lap.raceName);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [doc]);

  const lapsForSession = useMemo(() => {
    if (doc.status !== 'ready' || !round) return [];
    return doc.data.laps
      .filter((lap) => String(lap.round) === String(round) && lap.session === session)
      .sort((a, b) => a.lapTimeS - b.lapTimeS);
  }, [doc, round, session]);

  // Reopens with the fastest cars of the new selection drawn, rather than
  // carrying a driver over from a round or session that no longer has them.
  useEffect(() => {
    setSelected(lapsForSession.slice(0, MAX_COMPARE).map((lap) => lap.code));
  }, [lapsForSession]);

  const active = selected.filter((code) => lapsForSession.some((lap) => lap.code === code));

  const series = active.map((code, i) => {
    const lap = lapsForSession.find((l) => l.code === code);
    return {
      code,
      color: seriesColor(i),
      lap,
      envelope: lap.envelope.map((b) => ({ speedKph: b.kph, lateralG: b.g, samples: b.samples })),
    };
  });

  const focus = series[0]?.lap ?? null;

  const teamRows = useMemo(() => {
    if (teamsDoc.status !== 'ready') return [];
    const teams = [...new Set(teamsDoc.data.standings.map((r) => r.team))].sort();
    return teams.map((team) => ({
      team,
      laps: lapsForSession.filter((lap) => lap.team === team).sort((a, b) => a.lapTimeS - b.lapTimeS),
    }));
  }, [teamsDoc, lapsForSession]);

  if (doc.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/2026/aero.json." />;
  }
  if (doc.status === 'empty') {
    return (
      <EmptyState
        title="No aero export published yet"
        reason="The rig's numbers are derived from published racing lines by scripts/aero_export.mjs, run as part of the site build. Nothing has generated public/data/2026/aero.json yet."
      />
    );
  }

  const info = partInfo(selectedPart);
  const [verdictKind, verdictNote] = info.verdict;

  return (
    <section className="page">
      <header className="page-head">
        <h1>Aero Rig</h1>
        <p className="page-sub">
          A schematic 2026 car built to the published technical regulations, wearing numbers
          measured from real driven laps. Drag to orbit, scroll to zoom, click a part to ask
          what this project can actually say about it.
        </p>
      </header>

      <div className="warning-banner" role="note">
        <strong>The car is a diagram, not a scan.</strong> Its shape follows the 2026 regulations'
        published dimensions — it is not any team's real bodywork, which nobody publishes. Click a
        part for its verdict: <span className="mono">measured</span> means a real number backs it,{' '}
        <span className="mono">schematic</span> means only its geometry is known, and{' '}
        <span className="mono">refused</span> means nothing published anywhere gives this project
        a way to say anything about it.
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>The car</h2>
          <p className="panel-note">
            {MODE_COPY[mode].text} Only the flap angle changes between modes — this is not a
            simulation of the airflow itself, and no lap below is measured in X-mode; the sport
            does not publish which mode a car was in.
          </p>
        </div>

        <div className="rig-chamber">
          <AeroRigViewport mode={mode} onPick={setSelectedPart} className="rig-canvas" />
          <div className="rig-hud">
            <div className="mode-switch" role="group" aria-label="Active-aero mode">
              <button type="button" aria-pressed={mode === 'Z'} onClick={() => setMode('Z')}>
                Z · loaded
              </button>
              <button type="button" aria-pressed={mode === 'X'} onClick={() => setMode('X')}>
                X · flat
              </button>
            </div>
            <span className="rig-hint rig-hint-drag">drag to orbit · scroll to zoom</span>
          </div>
        </div>

        <div className="readout-bar">
          <div className="readout">
            <h3>{info.name}</h3>
            <p>{info.text}</p>
            <span className={`verdict-badge is-${verdictKind}`}>
              {VERDICT_LABEL[verdictKind]} · {verdictNote}
            </span>
          </div>
          <p className="rig-mode-note">{MODE_COPY[mode].label}</p>
        </div>
      </section>

      <div className="controls-row">
        <label>
          Round{' '}
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="">—</option>
            {roundOptions.map(([r, name]) => (
              <option key={r} value={r}>
                {r} · {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Session{' '}
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            <option value="Q">Qualifying</option>
            <option value="R">Race</option>
          </select>
        </label>
      </div>

      {lapsForSession.length === 0 ? (
        <EmptyState
          title="No lap exported for this round and session"
          reason="The position feed publishes a handful of drivers per session, and this combination has none exported yet. Pick another round or session above."
        />
      ) : (
        <>
          <div className="driver-picker">
            {lapsForSession.map((lap) => {
              const idx = selected.indexOf(lap.code);
              const on = idx >= 0;
              return (
                <label
                  key={lap.code}
                  className={`driver-chip${on ? ' is-on' : ''}`}
                  style={on ? { borderColor: seriesColor(idx) } : undefined}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && selected.length >= MAX_COMPARE}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, lap.code] : prev.filter((c) => c !== lap.code),
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
                  <span className="mono">{lap.code}</span>
                </label>
              );
            })}
          </div>

          {focus && (
            <div className="figure-grid">
              <div className="figure">
                <p className="figure-label">
                  <span className="mono">{focus.code}</span> top speed
                </p>
                <p className="figure-value mono">{Math.round(focus.topSpeedKph)}</p>
                <p className="figure-sample">km/h · this lap's true maximum</p>
              </div>
              <div className="figure">
                <p className="figure-label">Peak sustained lateral g</p>
                <p className="figure-value mono">{focus.peakLateralG.toFixed(1)}g</p>
                <p className="figure-sample">99th percentile of v²·κ</p>
              </div>
              <div className="figure">
                <p className="figure-label">Peak braking g</p>
                <p className="figure-value mono">{focus.peakBrakingG.toFixed(1)}g</p>
                <p className="figure-sample">brakes, engine braking and drag together</p>
              </div>
              <div className="figure">
                <p className="figure-label">Grip the lap implies</p>
                <p className="figure-value mono">{focus.impliedGripG.toFixed(2)}g</p>
                <p className="figure-sample">median of v²·κ across {focus.turns} turns</p>
              </div>
            </div>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Downforce signature</h2>
              <p className="panel-note">
                Lateral g sustained at each speed band. A car making more of its grip
                aerodynamically holds more g as speed rises; one running on mechanical grip alone
                stays flatter. This is the measured half of what the rig above draws from
                regulation geometry alone.
              </p>
            </div>
            <EnvelopeChart series={series} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Who this session has telemetry for</h2>
              <p className="panel-note">
                The position feed the pipeline decodes publishes a handful of drivers per
                session, not the full field — a blank tile is a car not exported yet, not a car
                measured at zero.
              </p>
            </div>
            <div className="figure-grid">
              {teamRows.map(({ team, laps }) => (
                <div className="figure" key={team}>
                  <p className="figure-label">{team}</p>
                  {laps.length > 0 ? (
                    <>
                      <p className="figure-value mono">{Math.round(laps[0].topSpeedKph)}</p>
                      <p className="figure-sample">
                        km/h · <span className="mono">{laps[0].code}</span>
                        {laps.length > 1 ? ` +${laps.length - 1} more` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="figure-note">no lap exported for this session</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="panel panel-limitations">
        <div className="panel-head">
          <h2>What this rig cannot tell you</h2>
        </div>
        <ul className="reason-list">
          {doc.data.limitations.map((line) => (
            <li key={line.slice(0, 40)}>{line}</li>
          ))}
        </ul>
      </section>

      <RelatedLinks
        context={`Each link opens on round ${round} rather than its own default.`}
        links={relatedLinks(['/aero', '/lines', '/style', '/strategy', '/qualifying'], {
          round,
          session,
        })}
      />
    </section>
  );
}
