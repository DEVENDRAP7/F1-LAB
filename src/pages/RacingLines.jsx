import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import { deltaTrace } from '../lib/delta.js';
import { accelerationTrace } from '../lib/aero.js';
import { detectTurns, turnDeltas } from '../lib/corners.js';
import {
  DEFAULT_SECTORS,
  miniSectors,
  sectorTally,
  winnerBySample,
} from '../lib/miniSectors.js';
import ChannelMap from '../components/ChannelMap.jsx';
import { lineToMapPoints, loadManifest, loadRacingLine } from '../lib/racingLine.js';
import {
  loadTelemetryIndex,
  newestRoundWithLines,
  sessionsWithLines,
} from '../lib/telemetryIndex.js';
import { seriesColor } from '../theme/palette.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { circuitForRound, relatedLinks } from '../lib/relatedLinks.js';
import { useUrlSelection, useUrlState } from '../lib/urlState.js';
import TelemetryTrace from '../components/TelemetryTrace.jsx';
import TrackMap from '../components/TrackMap.jsx';

// M3 — Racing Lines. Real driven lines only, decoded from the pipeline's
// Int16 .bin exports; the crosshair index is the single piece of shared
// state binding map, telemetry traces, and delta chart into one
// instrument (docs/SPEC.md section 5). Distance is the x-axis everywhere.

const SPACING_M = 2; // fixed resample spacing, pipeline/common.py
const MAX_DRIVERS = 4;
// Only the sessions the pipeline exports. Listing FP1 through the sprint
// offered five choices that could never load anything, which reads as a
// broken page rather than as a scope decision.
const SESSIONS = [
  { key: 'Q', label: 'Qualifying' },
  { key: 'R', label: 'Race' },
];

// What the map can be coloured by, beyond one hue per driver.
//
// Every one of these is a channel the source publishes, drawn as it comes
// — no derivation. The band edges are chosen for legibility rather than
// derived from the lap: bands that mean "a fifth of whatever this lap's
// maximum was" change meaning between circuits, so a reader comparing two
// rounds would be reading two different scales in the same colours.
//
// Colouring by channel shows one driver at a time on purpose. The colour
// is carrying the channel, so it cannot also carry identity, and two
// drivers drawn in the same ramp would be indistinguishable where their
// lines cross.
const COLOUR_CHANNELS = {
  driver: { label: 'One colour per driver' },
  speed: {
    label: 'Speed',
    channel: 'speed',
    scale: 'speed',
    bandEdges: [100, 175, 235, 290],
    unit: ' km/h',
    format: (v) => `${Math.round(v)} km/h`,
    smooth: true,
  },
  throttle: {
    label: 'Throttle',
    channel: 'throttle',
    scale: 'throttle',
    bandEdges: [1, 40, 70, 99],
    unit: '%',
    format: (v) => `${Math.round(v)}%`,
    smooth: true,
  },
  gear: {
    label: 'Gear',
    channel: 'gear',
    scale: 'gear',
    bandEdges: [4, 5, 6, 7],
    // The edges are whole gears, so each middle band is exactly one gear.
    bandLabels: ['gear 3 or lower', 'gear 4', 'gear 5', 'gear 6', 'gear 7 or 8'],
    format: (v) => `gear ${Math.round(v)}`,
    // Published as a whole number that steps; smoothing it would draw
    // gears the car was never in.
    smooth: false,
  },
  brake: {
    label: 'Brake',
    channel: 'brake',
    scale: 'brake',
    bandEdges: [1],
    bandLabels: ['off the brakes', 'on the brakes'],
    format: (v) => (v >= 1 ? 'on the brakes' : 'off the brakes'),
    smooth: false,
  },
};

export default function RacingLines() {
  const [season, setSeason] = useState({ status: 'loading', data: null });
  const [round, setRound] = useUrlState('round');
  // Opens on qualifying: it is the faster lap of the weekend, so it is
  // the one worth landing on. If no round has a qualifying line yet the
  // finder below falls back to the race rather than showing an empty
  // state on a page that does have data.
  const [session, setSession] = useUrlState('session', 'Q');
  const setSelection = useUrlSelection({ session: 'Q' });
  const [manifest, setManifest] = useState({ status: 'idle', data: null, error: null });
  const [selected, setSelected] = useState([]);
  const [lines, setLines] = useState({});
  const [crosshair, setCrosshair] = useState(0);
  const [colourBy, setColourBy] = useState('driver');
  const [showSectors, setShowSectors] = useState(false);
  const [index, setIndex] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setSeason({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setSeason({ status: 'empty', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Open on the newest round that actually has lines exported. The
  // backfill runs a few rounds at a time, so the most recent race is not
  // necessarily the most recent one with position data, and defaulting to
  // a round with nothing in it would show an empty state on a page that
  // does have data.
  useEffect(() => {
    if (season.status !== 'ready' || round) return undefined;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    const candidates = season.data.calendar
      .filter((r) => r.date <= today)
      .map((r) => r.round)
      .reverse();

    (async () => {
      // One listing rather than a probe per round per session: the
      // pipeline publishes what it has, so the page opens on the newest
      // round with a line without asking the network for a dozen files
      // that were never written.
      try {
        const listing = await loadTelemetryIndex(season.data.year);
        if (cancelled) return;
        setIndex(listing);
        const found = newestRoundWithLines(listing, candidates, [session, 'R']);
        if (found) {
          // One write, not two: see lib/urlState.js on why.
          setSelection({ round: found.round, session: found.session });
        }
      } catch {
        // No index published yet — the picker still works by hand.
      }
    })();

  }, [season, round, session]);

  useEffect(() => {
    if (!round) return;
    let cancelled = false;
    setManifest({ status: 'loading', data: null, error: null });
    setSelected([]);
    setLines({});
    loadManifest(round, session)
      .then((data) => {
        if (cancelled) return;
        setManifest({ status: 'ready', data, error: null });
        // Open with one line drawn rather than an empty map: the page is
        // about comparing lines, and a blank canvas on load reads as
        // "no data" on a page that has it.
        const first = Object.keys(data.drivers ?? {})[0];
        if (first) setSelected([first]);
      })
      .catch((error) => {
        if (!cancelled) setManifest({ status: 'empty', data: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, [round, session]);

  useEffect(() => {
    if (manifest.status !== 'ready') return;
    let cancelled = false;
    const missing = selected.filter((code) => !(code in lines));
    Promise.all(
      missing.map((code) =>
        loadRacingLine(round, session, code, manifest.data).then((channels) => [code, channels]),
      ),
    )
      .then((loaded) => {
        if (!cancelled && loaded.length > 0) {
          setLines((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
        }
      })
      .catch(() => {
        // Per-driver degradation: a failed line is simply absent, and the
        // manifest listing below tells the user which laps exist.
      });
    return () => {
      cancelled = true;
    };
  }, [selected, manifest, round, session, lines]);

  const active = selected.filter((code) => code in lines);

  const mapLines = useMemo(
    () =>
      active.map((code, i) => ({
        code,
        color: seriesColor(i),
        points: lineToMapPoints(lines[code], manifest.data.scale),
      })),
    [active, lines, manifest.data],
  );

  // The reference driver's chosen channel, in its published unit. Only
  // the first driver is drawn when colouring by channel: the colour is
  // carrying the channel, so it cannot also carry who.
  const channelValues = useMemo(() => {
    const spec = COLOUR_CHANNELS[colourBy];
    if (!spec?.channel || active.length === 0 || !manifest.data) return [];
    const raw = lines[active[0]][spec.channel];
    const divisor = manifest.data.scale[spec.scale] ?? 1;
    return Array.from(raw, (v) => v / divisor);
  }, [colourBy, active, lines, manifest.data]);

  const speedSeries = active.map((code, i) => ({
    code,
    color: seriesColor(i),
    values: lines[code].speed,
  }));
  const throttleSeries = active.map((code, i) => ({
    code,
    color: seriesColor(i),
    values: lines[code].throttle,
  }));

  const deltaSeries = useMemo(() => {
    if (active.length < 2) return [];
    const ref = lines[active[0]].speed;
    return active.slice(1).map((code, i) => ({
      code: `${code} vs ${active[0]}`,
      color: seriesColor(i + 1),
      values: deltaTrace(ref, lines[code].speed, SPACING_M),
    }));
  }, [active, lines]);

  // Who was fastest where. Capped at three drivers, and the cap is a
  // colour constraint rather than a layout one: on a map any two pieces
  // of track can end up side by side, so the palette has to hold up
  // across every pair at once, and only its first three slots do.
  const sectorDrivers = active.slice(0, 3);
  const sectors = useMemo(() => {
    if (!showSectors || sectorDrivers.length < 2 || !manifest.data) return null;
    const scale = manifest.data.scale.speed ?? 10;
    const rows = miniSectors(
      sectorDrivers.map((code) => ({ code, speedRaw: lines[code].speed })),
      SPACING_M,
    );
    return {
      rows,
      tally: sectorTally(rows, sectorDrivers),
      bySample: winnerBySample(rows, lines[sectorDrivers[0]].speed.length),
      scale,
    };
  }, [showSectors, sectorDrivers, lines, manifest.data]);

  // Where the delta was made. Turns are detected on the reference lap —
  // the one everything else is measured against — and each comparison
  // driver's time through a turn is read straight off the cumulative
  // delta trace at its ends. Nothing is integrated twice, and the
  // sections are the ones the geometry actually shows.
  const turnTable = useMemo(() => {
    if (active.length < 2 || !manifest.data) return null;
    const scale = manifest.data.scale;
    const reference = lines[active[0]];
    const trace = accelerationTrace({
      x: Array.from(reference.x, (v) => v / scale.x),
      y: Array.from(reference.y, (v) => v / scale.y),
      speed: Array.from(reference.speed, (v) => v / scale.speed),
    });
    const turns = detectTurns(trace);
    if (turns.length === 0) return null;

    const columns = deltaSeries.map((series, i) => ({
      code: active[i + 1],
      byTurn: new Map(turnDeltas(turns, series.values).map((t) => [t.number, t.deltaS])),
    }));

    const rows = turns.map((turn) => ({
      turn,
      // Ranked by the largest swing any comparison driver made through
      // it: that is the corner worth looking at, whichever way it went.
      worst: Math.max(...columns.map((c) => Math.abs(c.byTurn.get(turn.number) ?? 0))),
      cells: columns.map((c) => ({ code: c.code, deltaS: c.byTurn.get(turn.number) ?? 0 })),
    }));
    rows.sort((a, b) => b.worst - a.worst);
    return { rows, columns };
  }, [active, lines, manifest.data, deltaSeries]);

  if (season.status === 'loading') {
    return <EmptyState title="Loading calendar…" reason="Fetching public/data/season.json." />;
  }
  if (season.status === 'empty') {
    return (
      <EmptyState
        title="No session data published yet"
        reason="Racing lines are decoded from Int16 .bin artifacts written per session, and none exist yet. The telemetry backfill builds a few rounds per refresh, newest first."
      />
    );
  }

  const availableDrivers = manifest.status === 'ready' ? Object.keys(manifest.data.drivers) : [];

  return (
    <section>
      <h1>Racing Lines</h1>
      <div className="controls-row">
        <label>
          Round{' '}
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="">—</option>
            {season.data.calendar.map((r) => (
              <option key={r.round} value={r.round}>
                {r.round} · {r.raceName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Session{' '}
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {SESSIONS.map((s) => {
              const has = round ? sessionsWithLines(index, round, [s.key]).length > 0 : true;
              return (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {index && round && !has ? ' — no lines' : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Colour by{' '}
          <select value={colourBy} onChange={(e) => setColourBy(e.target.value)}>
            {Object.entries(COLOUR_CHANNELS).map(([key, spec]) => (
              <option key={key} value={key}>
                {spec.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="panel panel-limitations">
        <h2>What these lines are</h2>
        <p className="panel-note">
          Each line is one driver's fastest non-out lap of{' '}
          {manifest.data?.sessionLabel ?? 'the session'}, decoded from the position trace
          OpenF1 publishes at roughly 3.7 Hz and resampled onto a fixed distance grid. It is
          a lap somebody drove, not an average and not an ideal line, so two drivers' lines
          differ because they took different paths. A qualifying lap is the faster one — low
          fuel, fresh tyres — and a race lap is the one that had to last.
        </p>
        <p className="panel-note">
          Distances are in metres, converted using a scale measured per round rather than
          assumed — the position feed does not document its unit, so the pipeline recovers
          it by integrating published speed over the lap. Corner numbering is absent
          because this source publishes none, and numbering corners from memory would be
          invented detail.
        </p>
      </section>

      {!round && (
        <EmptyState
          title="Looking for a round with exported lines…"
          reason="The telemetry backfill runs a few rounds per refresh, so not every round has position data yet. Pick one above, or wait for the next refresh."
        />
      )}

      {round && manifest.status === 'ready' && manifest.data.unavailable && (
        <EmptyState
          title="No line for this race"
          reason={
            `${manifest.data.unavailable.reason}. `
            + (manifest.data.unavailable.perDriver ?? [])
              .map((d) => `${d.code}: ${d.reason}`)
              .join('; ')
            + '. This is what the source has, not a step still to run.'
          }
        />
      )}

      {round && manifest.status === 'loading' && (
        <EmptyState title="Loading session…" reason="Fetching the line manifest for this session." />
      )}

      {round && manifest.status === 'empty' && (
        <EmptyState
          title={`No lines exported for round ${round} ${session}`}
          reason="No racing line has been exported for this session. The blocker below is the same for every round, not something specific to this one."
        />
      )}

      {manifest.status === 'ready' && !manifest.data.unavailable && (
        <>
          <div className="driver-picker">
            {availableDrivers.map((code) => (
              <label key={code} className="driver-chip">
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  disabled={!selected.includes(code) && selected.length >= MAX_DRIVERS}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                    )
                  }
                />
                <span className="mono">{code}</span>
              </label>
            ))}
          </div>

          {active.length === 0 ? (
            <EmptyState
              title="Select up to 4 drivers"
              reason="Each selection decodes that driver's exported fastest lap from its .bin artifact."
            />
          ) : (
            <div className="lines-layout">
              {colourBy === 'driver' ? (
                <TrackMap
                  outline={mapLines[0].points}
                  lines={mapLines}
                  marker={
                    crosshair < mapLines[0].points.length ? mapLines[0].points[crosshair] : null
                  }
                  width={520}
                  height={520}
                />
              ) : (
                <ChannelMap
                  points={mapLines[0].points}
                  values={channelValues}
                  bandEdges={COLOUR_CHANNELS[colourBy].bandEdges}
                  label={`${active[0]} · ${COLOUR_CHANNELS[colourBy].label}`}
                  unit={COLOUR_CHANNELS[colourBy].unit ?? ''}
                  bandLabels={COLOUR_CHANNELS[colourBy].bandLabels ?? null}
                  formatValue={COLOUR_CHANNELS[colourBy].format}
                  smooth={COLOUR_CHANNELS[colourBy].smooth}
                  height={520}
                />
              )}
              <div className="traces-column">
                <TelemetryTrace
                  label="Speed"
                  unit=" km/h"
                  series={speedSeries}
                  spacingM={SPACING_M}
                  crosshairIndex={crosshair}
                  onCrosshair={setCrosshair}
                  formatValue={(v) => (v / 10).toFixed(0)}
                />
                <TelemetryTrace
                  label="Throttle"
                  unit=" %"
                  series={throttleSeries}
                  spacingM={SPACING_M}
                  crosshairIndex={crosshair}
                  onCrosshair={setCrosshair}
                  height={80}
                />
                {deltaSeries.length > 0 && (
                  <TelemetryTrace
                    label={`Delta to ${active[0]} (s) — integrated speed difference over distance`}
                    unit=" s"
                    series={deltaSeries}
                    spacingM={SPACING_M}
                    crosshairIndex={crosshair}
                    onCrosshair={setCrosshair}
                    formatValue={(v) => v.toFixed(3)}
                  />
                )}
              </div>
            </div>
          )}

          {active.length >= 2 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Who was fastest where</h2>
                <p className="panel-note">
                  The lap cut into {DEFAULT_SECTORS} equal fractions of itself, with each
                  piece taken by whoever crossed it quickest. Times come off the same
                  cumulative-time curve as the delta trace above, so the two cannot
                  disagree about who gained where. These are not the sport's timing-loop
                  mini-sectors — nothing here publishes where those loops are — and the
                  split is by fraction of each driver's own lap rather than by fixed
                  distance, because two measured racing lines are not the same length.
                </p>
              </div>

              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowSectors((on) => !on)}
              >
                {showSectors ? 'Hide the sector split' : 'Show the sector split'}
              </button>

              {showSectors && sectors && (
                <>
                  <ChannelMap
                    points={mapLines[0].points}
                    values={sectors.bySample}
                    bandEdges={sectorDrivers.slice(1).map((_, i) => i + 0.5)}
                    bandLabels={sectorDrivers.map(
                      (code) => `${code} · ${sectors.tally[code]} of ${DEFAULT_SECTORS}`,
                    )}
                    bandColors={sectorDrivers.map((_, i) => seriesColor(i))}
                    label="Fastest through"
                    smooth={false}
                    formatValue={(v) => sectorDrivers[Math.round(v)] ?? '—'}
                    height={460}
                  />
                  {active.length > sectorDrivers.length && (
                    <p className="panel-note">
                      Showing the first {sectorDrivers.length} of your {active.length}{' '}
                      selections. On a map any two pieces of track can end up touching, so
                      the colours have to stay apart across every pair at once — and only
                      three of them do.
                    </p>
                  )}
                  <div className="table-scroll table-wide">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Sector</th>
                          <th scope="col">Fastest</th>
                          <th scope="col" className="tabular">Margin</th>
                          {sectorDrivers.map((code) => (
                            <th key={code} scope="col" className="tabular">{code}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sectors.rows.map((row) => (
                          <tr key={row.sector}>
                            <td className="mono">{row.sector}</td>
                            <td>
                              <span
                                className="legend-swatch"
                                style={{ background: seriesColor(row.fastestIndex) }}
                                aria-hidden="true"
                              />{' '}
                              <span className="mono">{row.fastest}</span>
                            </td>
                            <td className="tabular">
                              {row.marginS == null ? '—' : `${row.marginS.toFixed(3)}s`}
                            </td>
                            {sectorDrivers.map((code) => {
                              const entry = row.times.find((t) => t.code === code);
                              return (
                                <td key={code} className="tabular">
                                  {entry ? entry.timeS.toFixed(3) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {turnTable && (
            <section className="panel">
              <div className="panel-head">
                <h2>Where the time went</h2>
                <p className="panel-note">
                  Turns detected on {active[0]}'s lap, ordered by the largest swing through
                  them. Each figure is that driver's time against {active[0]} through the
                  turn alone, read off the delta trace at its two ends — a positive number
                  is time lost. These are not the circuit's official corner numbers: nothing
                  this project reads publishes those, so they are numbered in the order this
                  lap meets them.
                </p>
              </div>
              <div className="table-scroll table-wide">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Turn</th>
                      <th scope="col" className="tabular">{active[0]} minimum</th>
                      {turnTable.columns.map((c) => (
                        <th key={c.code} scope="col" className="tabular">
                          {c.code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {turnTable.rows.map(({ turn, cells }) => (
                      <tr key={turn.number}>
                        <td className="mono">
                          T{turn.number} <span className="legend-fullname">{turn.direction}</span>
                        </td>
                        <td className="tabular">{Math.round(turn.minSpeedKph)} km/h</td>
                        {cells.map((cell) => (
                          <td key={cell.code} className="tabular">
                            {cell.deltaS >= 0 ? '+' : ''}
                            {cell.deltaS.toFixed(3)}s
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <RelatedLinks
            context={`Each link opens on round ${round} rather than its own default.`}
            links={relatedLinks(['/aero', '/style', '/circuits', '/strategy'], {
              round,
              session,
              circuit: circuitForRound(season.data?.calendar, round),
            })}
          />
        </>
      )}
    </section>
  );
}
