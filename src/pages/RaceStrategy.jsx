import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import { MAX_SERIES, seriesColor } from '../theme/palette.js';
import EmptyState from '../components/EmptyState.jsx';
import StintChart from '../components/StintChart.jsx';
import LapTimeChart from '../components/LapTimeChart.jsx';
import UndercutLedger from '../components/UndercutLedger.jsx';
import { formatLapTime } from '../lib/formatTime.js';
import { driverCode, driverIndex, driverName } from '../lib/driverNames.js';

const COMPOUND_TOKEN = {
  SOFT: 'soft',
  MEDIUM: 'medium',
  HARD: 'hard',
  INTERMEDIATE: 'inter',
  WET: 'wet',
};

// M4 — Tyre Strategy Board, on the data that actually exists.
//
// Every number here is measured: lap times and pit stops come from
// Jolpica-F1, stints are derived from the pit laps, and the pace trend
// per stint is a least-squares fit whose R^2 and sample count travel
// with it. What the source cannot supply — tyre compound, a track-status
// channel, a fuel-corrected degradation rate — is stated rather than
// filled in, both in the limitations panel and per-figure.

export default function RaceStrategy() {
  const [season, setSeason] = useState({ status: 'loading', data: null });
  const [round, setRound] = useState('');
  const [race, setRace] = useState({ status: 'idle', data: null });
  const [selected, setSelected] = useState([]);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => !cancelled && setSeason({ status: 'ready', data }))
      .catch(() => !cancelled && setSeason({ status: 'empty', data: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!round) return undefined;
    let cancelled = false;
    setRace({ status: 'loading', data: null });
    setSelected([]);
    fetch(dataPath(`2026/${round}/R/laps.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => !cancelled && setRace({ status: 'ready', data }))
      .catch(() => !cancelled && setRace({ status: 'empty', data: null }));
    return () => {
      cancelled = true;
    };
  }, [round]);

  const data = race.data;

  // Identity comes from the published entry list. Deriving a code from
  // the id (`slice(0, 3)`) produced MAX for Verstappen and ARV for
  // Lindblad — abbreviations that look official and are not.
  const names = useMemo(
    () => driverIndex(season.data?.entryList ?? []),
    [season.data],
  );

  // Finishing order from the final lap's classification: the order the
  // stint rows are drawn in, so the chart reads like a results sheet.
  const driverOrder = useMemo(() => {
    if (!data) return [];
    const lastByDriver = new Map();
    for (const lap of data.laps) {
      const prev = lastByDriver.get(lap.driverId);
      if (!prev || lap.lap > prev.lap) lastByDriver.set(lap.driverId, lap);
    }
    return [...lastByDriver.values()]
      .sort((a, b) => b.lap - a.lap || a.position - b.position)
      .map((l) => l.driverId);
  }, [data]);

  const lapSeries = useMemo(() => {
    if (!data || selected.length === 0) return [];
    const byDriver = new Map(selected.map((d) => [d, []]));
    for (const lap of data.laps) {
      if (byDriver.has(lap.driverId)) byDriver.get(lap.driverId).push(lap);
    }
    return selected.map((driverId, i) => ({
      code: driverCode(names, driverId),
      name: driverName(names, driverId),
      driverId,
      color: seriesColor(i),
      points: (byDriver.get(driverId) ?? []).sort((a, b) => a.lap - b.lap),
    }));
  }, [data, selected]);

  // Only the compounds this race actually ran get a legend entry: a
  // fixed five-band key would advertise wets at a dry race.
  const compoundsShown = useMemo(() => {
    if (!data) return [];
    const order = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];
    const present = new Set(
      data.stints.map((s) => (s.compound || '').toUpperCase()).filter(Boolean),
    );
    return order.filter((c) => present.has(c));
  }, [data]);

  const degradationRows = useMemo(() => {
    if (!data) return [];
    const wanted = selected.length > 0 ? new Set(selected) : null;
    return data.degradation
      .filter((d) => !wanted || wanted.has(d.driverId))
      .sort((a, b) => a.driverId.localeCompare(b.driverId) || a.stint - b.stint);
  }, [data, selected]);

  if (season.status === 'loading') {
    return <EmptyState title="Loading calendar…" reason="Fetching season.json." />;
  }
  if (season.status === 'empty') {
    return (
      <EmptyState
        title="No season data published yet"
        reason="season.json is written by the refresh-data workflow. Until it runs against the live API there is no calendar to pick a round from."
      />
    );
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Race Strategy</h1>
        <p className="page-sub">
          Stint structure and pace, derived from real lap times and pit stops.
        </p>
      </header>

      <div className="controls-row">
        <label>
          Round{' '}
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="">Select a race…</option>
            {season.data.calendar.map((r) => (
              <option key={r.round} value={r.round}>
                {String(r.round).padStart(2, '0')} · {r.raceName}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <span className="generated-at mono">
            {data.laps.length} laps · {driverOrder.length} drivers · generated {data.generated_at}
          </span>
        )}
      </div>

      {!round && (
        <EmptyState
          title="Pick a race"
          reason="Races appear here once the refresh workflow has exported their lap and pit-stop data. Rounds that have not run yet, or whose data the source has not published, simply will not load."
        />
      )}

      {round && race.status === 'loading' && (
        <EmptyState title="Loading race…" reason={`Fetching lap data for round ${round}.`} />
      )}

      {round && race.status === 'empty' && (
        <EmptyState
          title={`No lap data exported for round ${round}`}
          reason="Either this round has not happened yet, or the refresh workflow has not ingested it. Nothing is estimated to fill the gap."
        />
      )}

      {race.status === 'ready' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Stints</h2>
              <p className="panel-note">
                Boundaries are inferred from pit-stop laps. Bars are coloured by the tyre
                compound the OpenF1 stint feed publishes, matched to these stints by driver
                code and lap overlap. A stint that could not be matched confidently keeps
                the stint-order shading rather than being given a guessed compound.
              </p>
            </div>
            <StintChart
              codeFor={(id) => driverCode(names, id)}
              stints={data.stints}
              totalLaps={data.totalLaps}
              driverOrder={driverOrder}
            />
            {compoundsShown.length > 0 ? (
              <div className="stint-legend">
                <span className="legend-title">tyre</span>
                {compoundsShown.map((c) => (
                  <span key={c} className="legend-item">
                    <span
                      className="legend-swatch"
                      style={{ background: `var(--compound-${COMPOUND_TOKEN[c]})` }}
                      aria-hidden="true"
                    />
                    <span className="mono">{c.toLowerCase()}</span>
                  </span>
                ))}
                {data.compounds?.identified < data.compounds?.stints && (
                  <span className="legend-item">
                    <span
                      className="legend-swatch"
                      style={{ background: 'var(--stint-2)' }}
                      aria-hidden="true"
                    />
                    <span className="mono">unmatched</span>
                  </span>
                )}
              </div>
            ) : (
              <div className="stint-legend">
                <span className="legend-title">stint</span>
                {[1, 2, 3, 4].map((n) => (
                  <span key={n} className="legend-item">
                    <span
                      className="legend-swatch"
                      style={{ background: `var(--stint-${n})` }}
                      aria-hidden="true"
                    />
                    <span className="mono">{n === 4 ? '4+' : n}</span>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Lap pace</h2>
              <p className="panel-note">
                Select up to {MAX_SERIES} drivers to compare. Colour is assigned per
                selection slot and stays with the driver.
              </p>
            </div>

            <div className="driver-picker">
              {driverOrder.map((driverId) => {
                const idx = selected.indexOf(driverId);
                const isOn = idx >= 0;
                return (
                  <label
                    key={driverId}
                    className={`driver-chip${isOn ? ' is-on' : ''}`}
                    style={isOn ? { borderColor: seriesColor(idx) } : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={!isOn && selected.length >= MAX_SERIES}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, driverId]
                            : prev.filter((d) => d !== driverId),
                        )
                      }
                    />
                    {isOn && (
                      <span
                        className="legend-swatch"
                        style={{ background: seriesColor(idx) }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="mono">{driverCode(names, driverId)}</span>
                  </label>
                );
              })}
            </div>

            {lapSeries.length === 0 ? (
              <EmptyState
                title="No drivers selected"
                reason="Pick a driver above to plot their lap times across the race."
              />
            ) : (
              <>
                <LapTimeChart series={lapSeries} totalLaps={data.totalLaps} />
                <div className="chart-legend">
                  {lapSeries.map((s) => (
                    <span key={s.driverId} className="legend-item">
                      <span
                        className="legend-swatch"
                        style={{ background: s.color }}
                        aria-hidden="true"
                      />
                      <span className="mono">{s.code}</span>
                      <span className="legend-fullname">{s.driverId}</span>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowTable((v) => !v)}
                  aria-expanded={showTable}
                >
                  {showTable ? 'Hide' : 'Show'} lap times as a table
                </button>
                {showTable && (
                  <div className="table-scroll">
                    <table>
                      <caption className="visually-hidden">
                        Lap times per lap for the selected drivers
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Lap</th>
                          {lapSeries.map((s) => (
                            <th scope="col" key={s.driverId} className="tabular">
                              {s.code}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: data.totalLaps }, (_, i) => i + 1).map((lap) => (
                          <tr key={lap}>
                            <td className="mono">{lap}</td>
                            {lapSeries.map((s) => (
                              <td key={s.driverId} className="tabular">
                                {formatLapTime(s.points.find((p) => p.lap === lap)?.timeS)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          {data.undercuts && (
            <section className="panel">
              <div className="panel-head">
                <h2>Undercut ledger</h2>
                <p className="panel-note">
                  Every stop measured against rivals who were within 30 seconds and had not
                  yet stopped. Gaps come from elapsed race time — the running sum of lap
                  times — so no gap channel is needed.
                  {selected.length > 0 && ' Filtered to the drivers selected above.'}
                </p>
              </div>
              <UndercutLedger
              codeFor={(id) => driverCode(names, id)}
                undercuts={data.undercuts.entries ?? data.undercuts}
                excluded={data.undercuts.excluded}
                driverFilter={new Set(selected)}
              />
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Per-stint pace trend</h2>
              <p className="panel-note">
                Least-squares slope of lap time against tyre life within each stint. A slope
                is only called usable when it clears both a sample-count and an R² floor —
                the reason is shown either way.
              </p>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Driver</th>
                    <th scope="col" className="tabular">Stint</th>
                    <th scope="col" className="tabular">Trend s/lap</th>
                    <th scope="col" className="tabular">R²</th>
                    <th scope="col" className="tabular">Laps</th>
                    <th scope="col">Usable?</th>
                  </tr>
                </thead>
                <tbody>
                  {degradationRows.map((d) => (
                    <tr key={`${d.driverId}-${d.stint}`} className={d.reliable ? '' : 'is-muted'}>
                      <td className="mono">{driverCode(names, d.driverId)}</td>
                      <td className="tabular">{d.stint}</td>
                      <td className="tabular">
                        {d.reliable && d.deg_rate_s_per_lap != null
                          ? `${d.deg_rate_s_per_lap >= 0 ? '+' : ''}${d.deg_rate_s_per_lap.toFixed(3)}`
                          : '—'}
                      </td>
                      <td className="tabular">
                        {d.r_squared == null ? '—' : d.r_squared.toFixed(2)}
                      </td>
                      <td className="tabular">{d.sample_count}</td>
                      <td className="reason-cell">
                        <span className={d.reliable ? 'flag-ok' : 'flag-no'}>
                          {d.reliable ? 'yes' : 'no'}
                        </span>{' '}
                        <span className="reason-text">{d.reliability_reason}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="chart-caption">
              A negative trend means the driver got <em>faster</em> through the stint. That
              is normal and is not evidence of tyres improving: the slope also contains
              fuel burn and track evolution, which this source cannot separate from tyre
              degradation. Read it as net pace change per lap, not as a degradation rate.
            </p>
          </section>

          <section className="panel panel-limitations">
            <h2>What this page cannot tell you</h2>
            <ul>
              {data.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="panel-note mono">source: {data.source}</p>
          </section>
        </>
      )}
    </section>
  );
}
