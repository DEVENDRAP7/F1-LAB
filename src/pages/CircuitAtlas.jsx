import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { relatedLinks, roundForCircuit } from '../lib/relatedLinks.js';
import { useUrlState } from '../lib/urlState.js';
import TrackMap from '../components/TrackMap.jsx';
import { loadManifest, loadRacingLine } from '../lib/racingLine.js';
import { accelerationTrace } from '../lib/aero.js';
import { describeTurns, detectTurns, TURN_DEFAULTS } from '../lib/corners.js';
import TelemetryTrace from '../components/TelemetryTrace.jsx';
import { seriesColor } from '../theme/palette.js';
import { Method } from '../components/Disclosure.jsx';

// M1 — Circuit Atlas. The outline is a real driven lap: the position
// trace of the fastest race lap, in metres, thinned but not smoothed.
// It is not a drawing of the circuit and does not claim to be — it
// follows the racing line, which is where a car actually went, and the
// page says so rather than letting a reader assume a survey.
//
// Turns are DETECTED, not looked up. The position source publishes no
// corner numbering and neither does anything else this project reads, so
// what the page shows is where this lap carried lateral load — computed
// from the same published line the outline is drawn from, in the browser,
// so there is one implementation of the detection and no second artifact
// to fall out of step with the first.
//
// They are numbered in the order the lap meets them, which is not the
// circuit's official numbering and is labelled as such. DRS zones stay
// absent: the feed carries a DRS channel, but turning its integer codes
// into "the flap was open here" needs a mapping this project has no
// verified source for, and guessing it is the same mistake as numbering
// corners from memory.

export default function CircuitAtlas() {
  const [state, setState] = useState({ status: 'loading', season: null });
  const [selected, setSelected] = useUrlState('circuit');
  const [circuit, setCircuit] = useState({ status: 'idle', data: null });
  // Pit loss is measured per race and summarised per circuit, so it
  // arrives in one season-level file rather than with the geometry.
  const [pitLoss, setPitLoss] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((season) => {
        if (cancelled) return;
        setState({ status: 'ready', season });
        const today = new Date().toISOString().slice(0, 10);
        // Default to the most recent round that has run, unless the URL
        // already names a circuit on this calendar — a shared link should
        // land on the track it says, not on whatever is newest.
        const run = season.calendar.filter((r) => r.date <= today);
        const known = new Set(season.calendar.map((r) => r.circuitId));
        const newest = run.length > 0 ? run[run.length - 1].circuitId : '';
        setSelected((current) => (known.has(current) ? current : newest));
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'empty', season: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    setCircuit({ status: 'loading', data: null });
    fetch(dataPath(`circuits/${selected}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setCircuit({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setCircuit({ status: 'empty', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const [turns, setTurns] = useState({ status: 'idle', rows: [], code: null });
  const [elevationCursor, setElevationCursor] = useState(0);

  // The circuit file records the round it was traced from, so the lap
  // behind the outline is fetchable — and the turns are then detected on
  // the very lap the reader is looking at rather than on some other one.
  useEffect(() => {
    const doc = circuit.data;
    if (circuit.status !== 'ready' || !doc?.round) {
      setTurns({ status: 'idle', rows: [], code: null });
      return undefined;
    }
    let cancelled = false;
    setTurns({ status: 'loading', rows: [], code: null });

    (async () => {
      try {
        // The session the outline was traced from, so the turns are
        // detected on the very lap the map is drawing rather than on a
        // different one from the same weekend.
        const manifest = await loadManifest(doc.round, doc.sessionName ?? 'R');
        const code = manifest.laps?.[0]?.code ?? Object.keys(manifest.drivers)[0];
        const channels = await loadRacingLine(
          doc.round, doc.sessionName ?? 'R', code, manifest);
        if (cancelled) return;
        const scale = manifest.scale;
        const trace = accelerationTrace({
          x: Array.from(channels.x, (v) => v / scale.x),
          y: Array.from(channels.y, (v) => v / scale.y),
          speed: Array.from(channels.speed, (v) => v / scale.speed),
        });
        const detected = describeTurns(detectTurns(trace), channels);
        setTurns({
          status: detected.length > 0 ? 'ready' : 'empty',
          rows: detected,
          code,
          // Published only for a round whose z channel actually varies,
          // so its absence here is the pipeline's answer rather than a
          // missing feature.
          elevation: manifest.elevation?.usable ? channels.z ?? null : null,
          elevationScale: scale.z ?? 10,
          elevationRangeM: manifest.elevation?.rangeM ?? null,
          spacingM: 2,
          points: Array.from(channels.x, (v, i) => [v / scale.x, channels.y[i] / scale.y]),
          lapTimeS: manifest.laps?.find((l) => l.code === code)?.lapTimeS ?? null,
        });
      } catch {
        // A circuit whose round has no exported line still has an
        // outline; it simply has no turns to describe.
        if (!cancelled) setTurns({ status: 'empty', rows: [], code: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [circuit]);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('2026/pitloss.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setPitLoss(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const circuitPitLoss = useMemo(
    () => (pitLoss?.circuits ?? []).find((c) => c.circuitId === selected) ?? null,
    [pitLoss, selected],
  );

  const runRounds = useMemo(() => {
    if (!state.season) return [];
    const today = new Date().toISOString().slice(0, 10);
    return state.season.calendar.filter((r) => r.date <= today);
  }, [state.season]);

  if (state.status === 'loading') {
    return <EmptyState title="Loading calendar…" reason="Fetching public/data/season.json." />;
  }

  if (state.status === 'empty') {
    return (
      <EmptyState
        title="No calendar published yet"
        reason="season.json has not been generated by the refresh-data workflow yet."
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const doc = circuit.data;
  const scale = doc?.positionUnitsPerMetre;

  return (
    <section className="page">
      <header className="page-head">
        <h1>Circuit Atlas</h1>
        <p className="page-sub">
          Track outlines traced from real position telemetry — each one a lap somebody
          actually drove.
        </p>
        <p className="mono generated-at">generated {state.season.generated_at}</p>
      </header>

      {runRounds.length > 0 && (
        <div className="driver-picker">
          {runRounds.map((round) => (
            <button
              key={round.circuitId}
              type="button"
              className={`driver-chip${selected === round.circuitId ? ' is-on' : ''}`}
              onClick={() => setSelected(round.circuitId)}
            >
              <span className="mono">R{round.round}</span>
              <span className="legend-fullname">{round.circuitName}</span>
            </button>
          ))}
        </div>
      )}

      {circuit.status === 'loading' && (
        <EmptyState title="Loading circuit…" reason={`Fetching circuits/${selected}.json.`} />
      )}

      {circuit.status === 'empty' && (
        <EmptyState
          title="No geometry for this circuit yet"
          reason="The refresh writes a circuit outline from the race's position trace. This round has not been processed yet, or its position data could not be fetched."
        />
      )}

      {circuit.status === 'ready' && doc && (
        <section className="panel">
          <div className="panel-head">
            <h2>{doc.circuitName}</h2>
            <p className="panel-note">{doc.source}</p>
          </div>

          <div className="track-map-wrap">
            <TrackMap
              outline={doc.outline}
              corners={
                turns.status === 'ready' && turns.points
                  ? turns.rows.map((turn) => ({
                    number: turn.number,
                    x: turns.points[turn.apexIndex][0],
                    y: turns.points[turn.apexIndex][1],
                  }))
                  : []
              }
            />
          </div>

          <div className="figure-grid">
            <div className="figure">
              <p className="figure-label">Outline points</p>
              <p className="figure-value mono">{doc.outline?.length ?? 0}</p>
              <p className="figure-sample">position samples along one lap</p>
            </div>
            {scale && (
              <div className="figure">
                <p className="figure-label">Position unit</p>
                <p className="figure-value mono">{Number(scale.value).toFixed(2)}</p>
                <p className="figure-sample">
                  raw units per metre, over {scale.sample_size} samples
                </p>
                <p className="figure-note">{scale.source}</p>
              </div>
            )}
            {circuitPitLoss?.pitLoss?.published && (
              <div className="figure">
                <p className="figure-label">Pit loss</p>
                <p className="figure-value mono">
                  {circuitPitLoss.pitLoss.medianS.toFixed(1)}s
                </p>
                <p className="figure-sample">
                  median over {circuitPitLoss.pitLoss.drivers} drivers · middle half{' '}
                  {circuitPitLoss.pitLoss.q1S.toFixed(1)}–{circuitPitLoss.pitLoss.q3S.toFixed(1)}s
                </p>
                <p className="figure-note">{pitLoss.source}</p>
              </div>
            )}
          </div>

          {circuitPitLoss && !circuitPitLoss.pitLoss.published && (
            <p className="chart-caption">
              <strong>No pit loss published for this circuit.</strong>{' '}
              {circuitPitLoss.pitLoss.withheldReason}. Every stop this project measures is
              the in-lap and out-lap running slower than that driver's own fitted pace, added
              together — so it is what the stop cost, not the pit lane's own delta.
            </p>
          )}

          {turns.status === 'ready' && turns.elevation && (
            <>
              <div className="panel-head">
                <h3>Elevation</h3>
                <p className="panel-note">
                  The lap's height, over{' '}
                  <span className="mono">{Math.round(turns.elevationRangeM)}m</span> from its
                  lowest point to its highest.
                </p>
                <Method>
                  The position feed's own z channel, on the same measured unit as x and y
                  and relative to whatever datum that feed uses — not a height above sea
                  level. A round whose z does not vary gets no profile rather than a flat
                  line drawn at full scale.
                </Method>
              </div>
              <TelemetryTrace
                label="Elevation"
                unit=" m"
                series={[{
                  code: turns.code,
                  color: seriesColor(0),
                  values: turns.elevation,
                }]}
                spacingM={turns.spacingM}
                crosshairIndex={elevationCursor}
                onCrosshair={setElevationCursor}
                formatValue={(v) => (v / turns.elevationScale).toFixed(1)}
              />
            </>
          )}

          {turns.status === 'ready' && !turns.elevation && doc.elevation?.reason && (
            <p className="panel-note">Elevation: {doc.elevation.reason}.</p>
          )}

          {turns.status === 'ready' && (
            <>
              <div className="panel-head">
                <h3>Detected turns</h3>
                <p className="panel-note">
                  {turns.rows.length} stretches of {turns.code}'s fastest{' '}
                  {doc.sessionLabel ?? 'race'} lap
                  {turns.lapTimeS ? ` (${turns.lapTimeS.toFixed(3)}s)` : ''}, numbered in the
                  order the lap meets them rather than by the circuit's official numbers.
                </p>
                <Method label="How a turn is detected">
                  <p>
                    A stretch carrying at least{' '}
                    <span className="mono">{TURN_DEFAULTS.gThreshold.toFixed(1)}g</span> of
                    lateral load for at least{' '}
                    <span className="mono">{TURN_DEFAULTS.minLengthM}m</span>. Gear and
                    braking point come straight from the published channels; the apex is the
                    strongest point of the turn, its distance measured along the lap from
                    the start/finish line.
                  </p>
                  <p>
                    A turn "begins" where the load threshold is crossed rather than at the
                    geometric turn-in, so a braking point on a long banked corner reads
                    further back than a driver would describe it. Nothing here publishes the
                    official corner numbers.
                  </p>
                </Method>
              </div>
              <div className="table-scroll table-wide">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Turn</th>
                      <th scope="col" className="tabular">Entry</th>
                      <th scope="col" className="tabular">Minimum</th>
                      <th scope="col" className="tabular">Gear at apex</th>
                      <th scope="col" className="tabular">Braking point</th>
                      <th scope="col" className="tabular">Apex at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turns.rows.map((turn) => (
                      <tr key={turn.number}>
                        <td className="mono">
                          T{turn.number}{' '}
                          <span className="legend-fullname">{turn.direction}</span>
                        </td>
                        <td className="tabular">{Math.round(turn.entrySpeedKph)} km/h</td>
                        <td className="tabular">{Math.round(turn.minSpeedKph)} km/h</td>
                        <td className="tabular">{turn.gearAtApex ?? '—'}</td>
                        <td className="tabular">
                          {turn.brakingDistanceM == null
                            ? 'no braking'
                            : `${turn.brakingDistanceM} m before`}
                        </td>
                        <td className="tabular">{turn.apexDistanceM} m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {turns.status === 'empty' && (
            <p className="panel-note">
              No racing line exported for this round yet — an outline, but nothing to detect
              turns on.
            </p>
          )}

          {doc.limitations?.length > 0 && (
            <ul className="reason-list">
              {doc.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="table-scroll is-full">
        <table>
          <caption className="visually-hidden">{state.season.year} race calendar</caption>
          <thead>
            <tr>
              <th scope="col" className="tabular">Rd</th>
              <th scope="col">Grand Prix</th>
              <th scope="col">Circuit</th>
              <th scope="col" className="tabular">Date</th>
              <th scope="col">Format</th>
            </tr>
          </thead>
          <tbody>
            {state.season.calendar.map((round) => (
              <tr key={round.round} className={round.date > today ? 'is-muted' : ''}>
                <td className="tabular">{String(round.round).padStart(2, '0')}</td>
                <td>{round.raceName}</td>
                <td className="team-cell">{round.circuitName}</td>
                <td className="tabular">{round.date}</td>
                <td>
                  {round.sprint ? <span className="tag">sprint</span> : ''}
                  {round.date > today && <span className="tag tag-quiet">upcoming</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RelatedLinks
        context="Each link opens on the round run at this circuit rather than its own default."
        links={relatedLinks(['/lines', '/aero', '/strategy', '/qualifying'], {
          round: roundForCircuit(state.season?.calendar, selected),
          session: 'Q',
        })}
      />
    </section>
  );
}
