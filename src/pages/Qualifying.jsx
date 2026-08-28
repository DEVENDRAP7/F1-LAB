import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { circuitForRound, relatedLinks } from '../lib/relatedLinks.js';
import { useUrlState } from '../lib/urlState.js';
import { formatLapTime } from '../lib/formatTime.js';
import { driverIndex, driverCode, driverName } from '../lib/driverNames.js';
import { seriesColor } from '../theme/palette.js';

// Team-mate qualifying, which is the one comparison in this sport where
// the car is held constant.
//
// The count is of weekends, not of speed, and the page is built so that
// distinction survives being skimmed: the record is a tally with its
// sample beside it, the gap always names the segment it was measured in,
// and a weekend where the two never set a comparable lap shows as a beat
// with no gap rather than as a gap of zero.

const SEGMENTS = [
  { key: 'q1S', label: 'Q1' },
  { key: 'q2S', label: 'Q2' },
  { key: 'q3S', label: 'Q3' },
];

export default function Qualifying() {
  const [doc, setDoc] = useState({ status: 'loading', data: null });
  const [season, setSeason] = useState(null);
  const [round, setRound] = useUrlState('round');

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('2026/qualifying.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDoc({ status: 'ready', data });
        // Default to the latest round, unless the URL already names one that
        // this document actually has: a shared link should land where it says.
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

  const names = useMemo(() => driverIndex(season?.entryList ?? []), [season]);

  const grid = useMemo(() => {
    if (!doc.data || !round) return null;
    return doc.data.rounds.find((r) => String(r.round) === round) ?? null;
  }, [doc.data, round]);

  if (doc.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/2026/qualifying.json." />;
  }

  if (doc.status === 'empty') {
    return (
      <EmptyState
        title="No qualifying results published yet"
        reason="The refresh exports qualifying results for every round that has run. None have been written yet, or the source has not published them."
      />
    );
  }

  const teams = doc.data.teams ?? [];

  return (
    <section className="page">
      <header className="page-head">
        <h1>Qualifying</h1>
        <p className="page-sub">
          Team-mate against team-mate, which is the one comparison where the car is the
          same — and a count of weekends, never a claim about who is faster.
        </p>
      </header>

      <div className="warning-banner" role="note">
        <strong>The car is the same; the session is not.</strong> A red flag, an out-lap in
        traffic, or a track that improved after one driver's run all land in this count. It
        says what happened over {doc.data.rounds.length} rounds, with the sample beside every
        figure, and the gap always names the segment it was measured in.
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Head to head</h2>
          <p className="panel-note">
            Each weekend goes to whoever qualified further up the grid. The gap is the
            median across the weekends where both drivers set a time in the same segment —
            the last one they both reached — so it is a typical difference rather than the
            best or worst one.
          </p>
        </div>

        {teams.length === 0 ? (
          <p className="panel-note">
            No team has fielded the same two drivers across a full round yet.
          </p>
        ) : (
          <ul className="h2h-list">
            {teams.map((team) => {
              const [a, b] = team.drivers;
              const total = a.beats + b.beats || 1;
              return (
                <li key={team.constructorId} className="h2h-row">
                  <p className="h2h-team">{team.constructorName}</p>
                  <div className="h2h-bar-row">
                    <span className="h2h-name mono">{driverCode(names, a.driverId)}</span>
                    <span className="h2h-count mono tabular">{a.beats}</span>
                    <span
                      className="h2h-bar"
                      role="img"
                      aria-label={`${driverName(names, a.driverId)} ${a.beats}, `
                        + `${driverName(names, b.driverId)} ${b.beats}`}
                    >
                      <span
                        className="h2h-fill"
                        style={{
                          width: `${(a.beats / total) * 100}%`,
                          background: seriesColor(0),
                        }}
                      />
                      <span
                        className="h2h-fill"
                        style={{
                          width: `${(b.beats / total) * 100}%`,
                          background: seriesColor(1),
                        }}
                      />
                    </span>
                    <span className="h2h-count mono tabular">{b.beats}</span>
                    <span className="h2h-name mono">{driverCode(names, b.driverId)}</span>
                  </div>
                  <p className="h2h-note">
                    {team.rounds_compared} round{team.rounds_compared === 1 ? '' : 's'}
                    {team.medianGapS != null ? (
                      <>
                        {' · median gap '}
                        <span className="mono">{team.medianGapS.toFixed(3)}s</span>
                        {' over '}
                        {team.roundsWithGap} comparable lap
                        {team.roundsWithGap === 1 ? '' : 's'}
                      </>
                    ) : (
                      ' · no weekend where both set a comparable lap'
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>The grid, round by round</h2>
          <p className="panel-note">
            As published: every segment time the source carries. A blank is a session that
            driver set no time in, which is not the same as a slow one.
          </p>
        </div>

        <div className="controls-row">
          <label>
            Round{' '}
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              {doc.data.rounds.map((r) => (
                <option key={r.round} value={r.round}>
                  {String(r.round).padStart(2, '0')} · {r.raceName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {grid && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="tabular">Pos</th>
                  <th scope="col">Driver</th>
                  <th scope="col">Team</th>
                  {SEGMENTS.map((s) => (
                    <th key={s.key} scope="col" className="tabular">{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.results.map((row) => (
                  <tr key={row.driverId}>
                    <td className="tabular">{row.position}</td>
                    <td>
                      <span className="mono">{row.code ?? driverCode(names, row.driverId)}</span>{' '}
                      <span className="legend-fullname">
                        {driverName(names, row.driverId)}
                      </span>
                    </td>
                    <td>{row.constructorName}</td>
                    {SEGMENTS.map((s) => (
                      <td key={s.key} className="tabular">
                        {row[s.key] ? formatLapTime(row[s.key]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel panel-limitations">
        <div className="panel-head">
          <h2>What a head-to-head does not say</h2>
        </div>
        <ul className="reason-list">
          {(doc.data.limitations ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="panel-note mono">source: {doc.data.source}</p>
      </section>

      <RelatedLinks
        context={`Each link opens on round ${round} rather than its own default.`}
        links={relatedLinks(['/lines', '/style', '/aero', '/strategy', '/circuits'], {
          round,
          session: 'Q',
          circuit: circuitForRound(season?.calendar, round),
        })}
      />
    </section>
  );
}
