import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { Limitations, Method } from '../components/Disclosure.jsx';
import { circuitForRound, relatedLinks } from '../lib/relatedLinks.js';
import { useUrlState } from '../lib/urlState.js';
import { seriesColor } from '../theme/palette.js';

// Sprint weekends — the second race of the weekend, which the rest of
// this site does not show.
//
// The comparison a sprint weekend makes available and no other weekend
// does: the same drivers, the same cars and the same circuit, racing
// twice from two different grids about a day apart. Two figures come out
// of that, and both are counts of what happened rather than models —
// places changed between the grid and the flag, and how closely the two
// finishing orders agreed.
//
// The figures are computed in pipeline/derive_sprint.py and re-derived
// from the published rows by the validation gate. Nothing on this page
// is computed in the browser except formatting.

// A place gained and a place lost must be distinguishable without
// relying on colour, so the direction is a glyph and a word as well.
function Delta({ from, to }) {
  if (!from || !to) return <span className="mono">—</span>;
  const change = from - to;
  if (change === 0) return <span className="mono">held</span>;
  const gained = change > 0;
  return (
    <span className={`mono ${gained ? 'net-gain' : 'net-loss'}`}>
      {gained ? '▲' : '▼'} {Math.abs(change)}
    </span>
  );
}

function figure(value, digits = 2) {
  return value == null ? '—' : value.toFixed(digits);
}

export default function Sprint() {
  const [doc, setDoc] = useState({ status: 'loading', data: null });
  const [season, setSeason] = useState(null);
  const [round, setRound] = useUrlState('round');

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('2026/sprint.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDoc({ status: 'ready', data });
        // The newest sprint weekend, unless the URL already names one
        // this document has — a shared link should land where it says.
        const available = (data.rounds ?? []).map((r) => String(r.round));
        const last = available[available.length - 1] ?? '';
        setRound((current) => (available.includes(current) ? current : last));
      })
      .catch(() => !cancelled && setDoc({ status: 'empty', data: null }));

    fetch(dataPath('season.json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setSeason(data))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const weekend = useMemo(() => {
    if (!doc.data || !round) return null;
    const found = doc.data.rounds.find((r) => String(r.round) === round);
    if (!found) return null;
    // Finishing order, not alphabetical. The derivation sorts by driver
    // code so its output is stable to diff; a reader wants the race.
    const order = (a, b) =>
      (a.raceFinish ?? 99) - (b.raceFinish ?? 99)
      || (a.sprintFinish ?? 99) - (b.sprintFinish ?? 99)
      || a.driverCode.localeCompare(b.driverCode);
    return { ...found, drivers: [...found.drivers].sort(order) };
  }, [doc.data, round]);

  if (doc.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/2026/sprint.json." />;
  }

  if (doc.status === 'empty') {
    return (
      <EmptyState
        title="No sprint weekend published yet"
        reason="This page needs both races of a sprint weekend from the results feed. Either no sprint round has run, or the refresh has not fetched one where both results are published — half a weekend would compare one race against nothing."
      />
    );
  }

  const { season: summary, rounds, limitations } = doc.data;
  // One scale across the points table, so bar length means points. Scaling
  // each bar to its own total made every bar full width, which said only
  // "100% of this driver's points" — true of everyone, and useless.
  const pointsScale = Math.max(1, ...summary.pointsByDriver.map((r) => r.weekendPoints));
  const shorter = summary.sprintMeanPlacesChanged != null
    && summary.raceMeanPlacesChanged != null
    && summary.sprintMeanPlacesChanged < summary.raceMeanPlacesChanged;

  return (
    <section className="page">
      <header className="page-head">
        <h1>Sprint Weekends</h1>
        <p className="page-sub">
          The same drivers, the same cars and the same circuit, racing twice from two
          different grids inside a day. No other weekend offers that comparison.
        </p>
        <p className="mono generated-at">generated {doc.data.generated_at}</p>
      </header>

      <div className="warning-banner" role="note">
        <strong>Places changed is not overtakes.</strong> It is |finish − grid| over the
        drivers classified in each race. A place can move at a pit stop, at a retirement
        ahead, or in a penalty applied after the flag, and no source here publishes an
        overtake feed to tell those apart. The lap count of each race sits beside it rather
        than being divided into it.
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Across {summary.roundsRun} sprint weekend{summary.roundsRun === 1 ? '' : 's'}</h2>
          <p className="panel-note">
            The mean over the rounds that had one. A round whose sample was too thin
            contributes nothing rather than a placeholder.
          </p>
        </div>

        <div className="figure-grid">
          <div className="figure">
            <p className="figure-label">Places changed · sprint</p>
            <p className="figure-value mono">{figure(summary.sprintMeanPlacesChanged)}</p>
            <p className="figure-sample">
              mean |finish − grid| per classified driver, over{' '}
              {summary.movementRoundsCounted} round
              {summary.movementRoundsCounted === 1 ? '' : 's'}
            </p>
          </div>
          <div className="figure">
            <p className="figure-label">Places changed · grand prix</p>
            <p className="figure-value mono">{figure(summary.raceMeanPlacesChanged)}</p>
            <p className="figure-sample">the same weekends, the longer race</p>
          </div>
          <div className="figure">
            <p className="figure-label">Rank agreement</p>
            <p className="figure-value mono">
              {summary.medianRho == null ? 'withheld' : figure(summary.medianRho)}
            </p>
            <p className="figure-sample">
              {summary.medianRho == null
                ? 'no round had enough drivers classified in both races'
                : `median Spearman's ρ over ${summary.rhoRoundsCounted} round${
                  summary.rhoRoundsCounted === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {summary.sprintMeanPlacesChanged != null && summary.raceMeanPlacesChanged != null && (
          <p className="chart-caption">
            The sprint changed {shorter ? 'fewer' : 'more'} places than the grand prix on
            these weekends. That is a difference between two races of different lengths and
            different grids, not evidence about either format: the lap counts are in the
            table below, and nothing here separates the length of a race from anything else
            about it.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>The weekend, race by race</h2>
          <p className="panel-note">
            Both results as published, joined on the driver code.
          </p>
          <Method>
            A driver who did not finish keeps the position the feed gives them, marked as
            not classified, and is excluded from every figure above.
          </Method>
        </div>

        <div className="controls-row">
          <label>
            Round{' '}
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              {rounds.map((r) => (
                <option key={r.round} value={r.round}>
                  {String(r.round).padStart(2, '0')} · {r.raceName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {weekend && (
          <>
            <div className="sprint-summary-row">
              <span className="mono">
                sprint {weekend.sprintLaps} laps · {weekend.sprintMovement.sample} classified
                {weekend.sprintMovement.excluded > 0
                  ? ` · ${weekend.sprintMovement.excluded} excluded`
                  : ''}
              </span>
              <span className="mono">
                grand prix {weekend.raceLaps} laps · {weekend.raceMovement.sample} classified
                {weekend.raceMovement.excluded > 0
                  ? ` · ${weekend.raceMovement.excluded} excluded`
                  : ''}
              </span>
              <span className="mono">
                {weekend.rankAgreement.rho == null
                  ? 'ρ withheld'
                  : `ρ ${weekend.rankAgreement.rho.toFixed(2)} over ${weekend.rankAgreement.n} driver${
                    weekend.rankAgreement.n === 1 ? '' : 's'}`}
              </span>
            </div>

            {weekend.rankAgreement.rho == null && (
              <p className="panel-note">{weekend.rankAgreement.withheldReason}</p>
            )}

            <div className="table-scroll table-wide is-full">
              <table>
                <caption className="visually-hidden">
                  {weekend.raceName}: sprint and grand prix results side by side
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Driver</th>
                    <th scope="col">Team</th>
                    <th scope="col" className="tabular">Sprint</th>
                    <th scope="col" className="tabular">Sprint Δ</th>
                    <th scope="col" className="tabular">GP</th>
                    <th scope="col" className="tabular">GP Δ</th>
                    <th scope="col" className="tabular">Sprint pts</th>
                    <th scope="col" className="tabular">GP pts</th>
                  </tr>
                </thead>
                <tbody>
                  {weekend.drivers.map((d) => (
                    <tr key={d.driverCode}>
                      <th scope="row" className="mono">{d.driverCode}</th>
                      <td className="team-cell">{d.team}</td>
                      <td className="tabular">
                        {d.sprintFinish ? `P${d.sprintFinish}` : '—'}
                        {d.sprintFinish && !d.sprintClassified && (
                          <span className="tag tag-quiet" title={d.sprintStatus}>
                            {d.sprintStatus}
                          </span>
                        )}
                      </td>
                      <td className="tabular">
                        {d.sprintClassified
                          ? <Delta from={d.sprintGrid} to={d.sprintFinish} />
                          : <span className="mono">—</span>}
                      </td>
                      <td className="tabular">
                        {d.raceFinish ? `P${d.raceFinish}` : '—'}
                        {d.raceFinish && !d.raceClassified && (
                          <span className="tag tag-quiet" title={d.raceStatus}>
                            {d.raceStatus}
                          </span>
                        )}
                      </td>
                      <td className="tabular">
                        {d.raceClassified
                          ? <Delta from={d.raceGrid} to={d.raceFinish} />
                          : <span className="mono">—</span>}
                      </td>
                      <td className="tabular">{d.sprintPoints ? d.sprintPoints : '—'}</td>
                      <td className="tabular">{d.racePoints ? d.racePoints : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="chart-caption">
              Δ is places changed from that race's own grid: ▲ gained, ▼ lost. A driver who
              started from the pit lane has no grid slot in this feed and shows no Δ.
            </p>
          </>
        )}
      </section>

      {summary.pointsByDriver.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>What the sprint was worth</h2>
            <p className="panel-note">
              Points taken on these weekends only, split between the two races — a share of
              the sprint rounds, not of anyone's season.
            </p>
          </div>

          <ul className="split-list">
            {summary.pointsByDriver.map((row) => (
              <li key={row.driverCode} className="split-row">
                <span className="split-name mono">{row.driverCode}</span>
                <span
                  className="split-bar"
                  role="img"
                  aria-label={`${row.driverName}: ${row.sprintPoints} from sprints, `
                    + `${row.racePoints} from grands prix`}
                >
                  <span
                    className="split-fill"
                    style={{
                      width: `${(row.sprintPoints / pointsScale) * 100}%`,
                      background: seriesColor(0),
                    }}
                  />
                  <span
                    className="split-fill"
                    style={{
                      width: `${(row.racePoints / pointsScale) * 100}%`,
                      background: seriesColor(1),
                    }}
                  />
                </span>
                <span className="split-figure mono tabular">
                  {row.sprintPoints} + {row.racePoints}
                </span>
                <span className="split-note mono tabular">
                  {row.sprintShare == null ? '—' : `${Math.round(row.sprintShare * 100)}% sprint`}
                </span>
              </li>
            ))}
          </ul>
          <p className="chart-caption">
            <span className="legend-swatch" style={{ background: seriesColor(0) }} /> sprint
            {'  '}
            <span className="legend-swatch" style={{ background: seriesColor(1) }} /> grand prix.
            Bar length is points, on one scale across the table, split at the point where
            the sprint's share ends. The two figures beside it are the points themselves, so
            the bar is a reading aid rather than the only place the number appears.
          </p>
        </section>
      )}

      <Limitations title="What this page cannot tell you">
        {limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li className="mono">source: {doc.data.source}</li>
      </Limitations>

      <RelatedLinks
        context={`Each link opens on round ${round} rather than its own default.`}
        links={relatedLinks(['/strategy', '/qualifying', '/lines', '/errors', '/circuits'], {
          round,
          session: 'R',
          circuit: circuitForRound(season?.calendar, round),
        })}
      />
    </section>
  );
}
