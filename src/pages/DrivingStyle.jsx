import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import { loadManifest, loadRacingLine } from '../lib/racingLine.js';
import { loadTelemetryIndex, newestRoundWithLines } from '../lib/telemetryIndex.js';
import { accelerationTrace } from '../lib/aero.js';
import { drivingStyle, STYLE_METRICS } from '../lib/style.js';
import { sessionCost } from '../lib/sessionCost.js';
import { seriesColor } from '../theme/palette.js';
import { formatLapTime } from '../lib/formatTime.js';

// Driving style — how a lap was driven, which is a different question
// from how quick it was.
//
// There is no ranking on this page and no "best" column, on purpose.
// Carrying more speed into a corner is not superior to braking later and
// turning tighter; they are different ways round the same piece of
// track, and which is quicker depends on the corner, the car and the
// tyre. The bars are scaled within each metric so the drivers can be
// compared to each other, and every metric says how it was measured.

export default function DrivingStyle() {
  const [season, setSeason] = useState(null);
  const [round, setRound] = useState('');
  const [session, setSession] = useState('Q');
  const [manifest, setManifest] = useState({ status: 'loading', data: null });
  const [lines, setLines] = useState({});
  // The other session for the same round, loaded only to compare against.
  const [other, setOther] = useState({ manifest: null, lines: {} });

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setSeason(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!season || round) return undefined;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    const candidates = season.calendar
      .filter((r) => r.date <= today)
      .map((r) => r.round)
      .reverse();

    (async () => {
      try {
        const index = await loadTelemetryIndex(season.year);
        const found = newestRoundWithLines(index, candidates);
        if (found && !cancelled) {
          setSession(found.session);
          setRound(found.round);
          return;
        }
      } catch {
        // no index yet
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

    (async () => {
      try {
        const found = await loadManifest(round, session);
        if (cancelled) return;
        setManifest({ status: 'ready', data: found });
        const codes = Object.keys(found.drivers ?? {});
        const decoded = await Promise.all(
          codes.map((code) =>
            loadRacingLine(round, session, code, found).then((ch) => [code, ch])),
        );
        if (!cancelled) setLines(Object.fromEntries(decoded));
      } catch {
        if (!cancelled) setManifest({ status: 'empty', data: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [round, session]);

  // The same driver's other lap of the weekend. A qualifying lap and a
  // race lap of the same circuit are the two ends of the strategy
  // question, and both are already published — they were just never put
  // beside each other.
  useEffect(() => {
    if (!round) return undefined;
    let cancelled = false;
    const counterpart = session === 'Q' ? 'R' : 'Q';
    setOther({ manifest: null, lines: {} });

    (async () => {
      try {
        const found = await loadManifest(round, counterpart);
        if (cancelled || found.unavailable) return;
        const codes = Object.keys(found.drivers ?? {});
        const decoded = await Promise.all(
          codes.map((code) =>
            loadRacingLine(round, counterpart, code, found).then((ch) => [code, ch])),
        );
        if (!cancelled) {
          setOther({ manifest: found, lines: Object.fromEntries(decoded) });
        }
      } catch {
        // The counterpart session has no lines; the panel simply does not
        // appear, which the page says.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [round, session]);

  const costs = useMemo(() => {
    if (manifest.status !== 'ready' || !other.manifest) return [];
    const qualifyingIsHere = session === 'Q';
    return Object.keys(lines)
      .filter((code) => code in other.lines)
      .map((code) => {
        const here = {
          speedRaw: lines[code].speed,
          lapTimeS: manifest.data.laps?.find((l) => l.code === code)?.lapTimeS ?? null,
        };
        const there = {
          speedRaw: other.lines[code].speed,
          lapTimeS: other.manifest.laps?.find((l) => l.code === code)?.lapTimeS ?? null,
        };
        const [q, r] = qualifyingIsHere ? [here, there] : [there, here];
        return { code, cost: sessionCost(q, r, 2) };
      })
      .filter((entry) => entry.cost);
  }, [manifest, lines, other, session]);

  const styles = useMemo(() => {
    if (manifest.status !== 'ready') return [];
    const scale = manifest.data.scale;
    return Object.entries(lines).map(([code, channels], i) => {
      const trace = accelerationTrace({
        x: Array.from(channels.x, (v) => v / scale.x),
        y: Array.from(channels.y, (v) => v / scale.y),
        speed: Array.from(channels.speed, (v) => v / scale.speed),
      });
      return {
        code,
        color: seriesColor(i),
        lapTimeS: manifest.data.laps?.find((l) => l.code === code)?.lapTimeS ?? null,
        style: drivingStyle(
          {
            throttle: Array.from(channels.throttle, (v) => v / (scale.throttle ?? 1)),
            brake: Array.from(channels.brake, (v) => v / (scale.brake ?? 1)),
            gear: Array.from(channels.gear, (v) => v / (scale.gear ?? 1)),
            speed: Array.from(channels.speed, (v) => v / scale.speed),
          },
          trace,
        ),
      };
    }).filter((entry) => entry.style);
  }, [manifest, lines]);

  const pastRounds = useMemo(() => {
    if (!season) return [];
    const today = new Date().toISOString().slice(0, 10);
    return season.calendar.filter((r) => r.date <= today);
  }, [season]);

  if (!season) {
    return <EmptyState title="Loading…" reason="Fetching public/data/season.json." />;
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Driving Style</h1>
        <p className="page-sub">
          How a lap was driven, which is a different question from how quick it was. Two
          drivers a tenth apart can reach that tenth in opposite ways.
        </p>
      </header>

      <div className="warning-banner" role="note">
        <strong>There is no better column here.</strong> Carrying more speed into a corner
        is not superior to braking later and turning tighter — they are different ways round
        the same piece of track, and which one is quicker depends on the corner, the car and
        the tyre. Every figure is one lap, on that lap's fuel and tyre, from channels the
        source publishes rather than anything fitted.
      </div>

      {pastRounds.length > 0 && (
        <div className="controls-row">
          <label>
            Round{' '}
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              {pastRounds.map((r) => (
                <option key={r.round} value={r.round}>
                  {String(r.round).padStart(2, '0')} · {r.raceName}
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
          {manifest.data?.sessionLabel && (
            <span className="generated-at mono">
              fastest {manifest.data.sessionLabel} laps
            </span>
          )}
        </div>
      )}

      {manifest.status === 'loading' && (
        <EmptyState title="Loading…" reason={`Decoding the lines for round ${round}.`} />
      )}

      {manifest.status === 'empty' && (
        <EmptyState
          title="No lines for this round and session"
          reason="Driving style is read off the published racing lines. This round and session has none — the Racing Lines page says whether that is a backfill still to run or a feed with nothing usable in it."
        />
      )}

      {styles.length > 0 && (
        <>
          <div className="driver-picker">
            {styles.map((entry) => (
              <span key={entry.code} className="driver-chip is-on">
                <span
                  className="legend-swatch"
                  style={{ background: entry.color }}
                  aria-hidden="true"
                />
                <span className="mono">{entry.code}</span>
                <span className="legend-fullname">
                  {entry.lapTimeS ? formatLapTime(entry.lapTimeS) : ''}
                </span>
              </span>
            ))}
          </div>

          {STYLE_METRICS.map((metric) => {
            const values = styles.map((entry) => entry.style[metric.key]);
            const usable = values.filter((v) => v != null);
            const max = usable.length ? Math.max(...usable) : 0;
            return (
              <section className="panel style-panel" key={metric.key}>
                <div className="panel-head">
                  <h2>{metric.label}</h2>
                  <p className="panel-note">{metric.note}</p>
                </div>
                <ul className="style-list">
                  {styles.map((entry) => {
                    const value = entry.style[metric.key];
                    return (
                      <li key={entry.code} className="style-row">
                        <span className="style-code mono">{entry.code}</span>
                        <span className="style-track">
                          <span
                            className="style-fill"
                            style={{
                              width: value == null || max === 0
                                ? '0%'
                                : `${(value / max) * 100}%`,
                              background: entry.color,
                            }}
                          />
                        </span>
                        <span className="style-value mono tabular">
                          {metric.format(value)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {costs.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>What the race costs a lap</h2>
                <p className="panel-note">
                  The same driver, the same circuit, both sessions: a qualifying lap
                  against their fastest lap of the race, and where on the circuit the
                  difference was paid. The cost is the official gap between the two laps.
                  The sector split cannot be — no source publishes one — so it is
                  integrated from the speed channels, which recovers most of that gap but
                  not all of it: the "recovered" column is how much, and the sector
                  figures should be read as where the cost fell rather than as a second
                  measurement of how large it was.
                </p>
              </div>
              <div className="table-scroll table-wide">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Driver</th>
                      <th scope="col" className="tabular">Qualifying</th>
                      <th scope="col" className="tabular">Race</th>
                      <th scope="col" className="tabular">Cost</th>
                      <th scope="col" className="tabular">Top speed</th>
                      <th scope="col" className="tabular">Worst twelfth</th>
                      <th scope="col" className="tabular">Recovered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map(({ code, cost }) => (
                      <tr key={code}>
                        <td className="mono">{code}</td>
                        <td className="tabular">
                          {cost.officialQualifyingS
                            ? formatLapTime(cost.officialQualifyingS)
                            : formatLapTime(cost.integratedQualifyingS)}
                        </td>
                        <td className="tabular">
                          {cost.officialRaceS
                            ? formatLapTime(cost.officialRaceS)
                            : formatLapTime(cost.integratedRaceS)}
                        </td>
                        <td className="tabular loss-cell">
                          +{(cost.officialCostS ?? cost.integratedCostS).toFixed(3)}s
                        </td>
                        <td className="tabular">
                          {cost.topSpeedCostKph >= 0 ? '+' : ''}
                          {Math.round(cost.topSpeedCostKph)} km/h
                        </td>
                        <td className="tabular">
                          {cost.worstSector
                            ? `#${cost.worstSector.sector} · +${cost.worstSector.costS.toFixed(2)}s`
                            : '—'}
                        </td>
                        <td className="tabular">
                          {cost.officialCostS
                            ? `${((cost.integratedCostS / cost.officialCostS) * 100).toFixed(0)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel-note">
                This is not a fuel-and-tyre figure. The gap contains fuel load, tyre age
                and compound, engine mode, traffic, and a circuit that rubbered in across
                the weekend — nothing here separates them. It is the measured cost of the
                same driver doing the same lap under race conditions.
              </p>
            </section>
          )}

          <section className="panel panel-limitations">
            <div className="panel-head">
              <h2>What this cannot tell you</h2>
            </div>
            <ul className="reason-list">
              <li>
                No steering channel is published here, so nothing on this page is about
                what a driver did with their hands — only with the pedals and the gearbox.
              </li>
              <li>
                Brake is published as on or off, not as pressure. Trail braking and a
                stab at the pedal look identical in this data.
              </li>
              <li>
                One lap each, on that lap's fuel and tyre. A qualifying lap and a race lap
                are different exercises, and the picker above says which you are reading.
              </li>
              <li>
                Corners come from this project's own turn detection — a stretch carrying
                at least 1g of lateral load — not from the circuit's official numbering,
                which nothing here publishes.
              </li>
              <li>
                A corner whose exit runs into the next braking zone never reaches full
                throttle. It is left out of the throttle-pickup average rather than
                counted as the length of the search.
              </li>
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
