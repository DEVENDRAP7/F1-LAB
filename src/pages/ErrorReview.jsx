import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { circuitForRound, relatedLinks } from '../lib/relatedLinks.js';
import { useUrlState } from '../lib/urlState.js';
import { formatDelta, formatLapTime } from '../lib/formatTime.js';
import { Method } from '../components/Disclosure.jsx';

// M7 — Driver Error Review.
//
// The language rule is the design here. Nothing on this page says a
// driver made a mistake, because nothing in the data establishes that.
// There are two distinct kinds of row and they are never mixed:
//
//   RECORDED  what race control published, verbatim, attributed by the
//             car number the feed itself carries.
//   FLAGGED   this pipeline's own observation that a lap was slower than
//             the same driver's own green-flag median — a deviation,
//             with the cause explicitly not identified.
//
// The distinction is carried visually, not just in a footnote, because a
// reader who conflates the two ends up believing the site has accused
// someone of something.

const SEVERITY_ORDER = { major: 0, moderate: 1, minor: 2 };

export default function ErrorReview() {
  const [season, setSeason] = useState({ status: 'loading', data: null });
  const [round, setRound] = useUrlState('round');
  const [review, setReview] = useState({ status: 'idle', data: null });
  const [driver, setDriver] = useUrlState('driver');

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

  // Open on the newest round that actually has a review exported; the
  // telemetry backfill runs a few rounds at a time, so the newest round
  // and the newest reviewed round are not the same thing.
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
          const res = await fetch(dataPath(`2026/${candidate}/R/errors.json`));
          if (!res.ok) continue;
          if (!cancelled) setRound(String(candidate));
          return;
        } catch {
          // try the round before it
        }
      }
      if (!cancelled) setReview({ status: 'empty', data: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [season, round]);

  useEffect(() => {
    if (!round) return undefined;
    let cancelled = false;
    setReview({ status: 'loading', data: null });
    fetch(dataPath(`2026/${round}/R/errors.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setReview({ status: 'ready', data });
        const codes = Object.keys(data.drivers ?? {}).sort();
        // A driver named in the URL survives a round change when this round
        // has them too; otherwise fall back to the first rather than showing
        // an empty panel for a driver who is not in this race.
        setDriver((current) => (codes.includes(current) ? current : codes[0] ?? ''));
      })
      .catch(() => {
        if (cancelled) return;
        setReview({ status: 'empty', data: null });
        setDriver('');
      });
    return () => {
      cancelled = true;
    };
  }, [round]);

  const pastRounds = useMemo(() => {
    if (!season.data) return [];
    const today = new Date().toISOString().slice(0, 10);
    return season.data.calendar.filter((r) => r.date <= today);
  }, [season.data]);

  if (season.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/season.json." />;
  }

  const doc = review.data;
  const entry = doc?.drivers?.[driver];
  const noted = (entry?.recorded ?? []).filter((r) => r.nature !== 'informational');
  const informational = (entry?.recorded ?? []).filter((r) => r.nature === 'informational');
  const flagged = [...(entry?.flagged ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.lap - b.lap,
  );

  return (
    <section className="page">
      <header className="page-head">
        <h1>Driver Error Review</h1>
        <p className="page-sub">
          What race control recorded, and which laps ran slower than a driver's own pace.
          Nothing here diagnoses a mistake.
        </p>
      </header>

      <div className="warning-banner" role="note">
        <strong>A flag is not a verdict.</strong> Recorded events are official race-control
        messages, quoted as published. Flagged laps are this site's own observation that a
        lap was slower than the same driver's median green-flag lap in the same race — and
        traffic, track conditions and a pit-wall instruction all produce that signature just
        as readily as a driver error does. The cause is not identified anywhere on this page.
      </div>

      {pastRounds.length > 0 && (
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
      )}

      {review.status === 'loading' && (
        <EmptyState title="Loading review…" reason={`Fetching the review for round ${round}.`} />
      )}

      {review.status === 'empty' && (
        <EmptyState
          title="No review for this round yet"
          reason="The review is written alongside the telemetry backfill, which processes a few rounds per refresh. This round has not been reached yet."
        />
      )}

      {review.status === 'ready' && doc && (
        <>
          <div className="driver-picker">
            {Object.keys(doc.drivers).sort().map((code) => {
              const d = doc.drivers[code];
              const count = d.recorded.length + d.flagged.length;
              return (
                <button
                  key={code}
                  type="button"
                  className={`driver-chip${driver === code ? ' is-on' : ''}`}
                  onClick={() => setDriver(code)}
                >
                  <span className="mono">{code}</span>
                  <span className="legend-fullname">{count}</span>
                </button>
              );
            })}
          </div>

          {!entry && (
            <EmptyState
              title="Nothing recorded or flagged for this driver"
              reason="No race-control message named this car, and no lap ran far enough off their own pace to flag. That is a quiet race, not a clean-driving award."
            />
          )}

          {entry && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h2>Recorded by race control</h2>
                  <p className="panel-note">
                    Official messages concerning this car, quoted exactly as published and
                    attributed by car number rather than by reading the text.
                  </p>
                </div>
                {noted.length === 0 ? (
                  <p className="panel-note">
                    No race-control message concerning this car's own conduct.
                  </p>
                ) : (
                  <ul className="reason-list">
                    {noted.map((r, i) => (
                      <li key={`${r.lap}-${i}`}>
                        {r.lap ? <span className="mono">L{r.lap} </span> : null}
                        {r.message}
                      </li>
                    ))}
                  </ul>
                )}

                {informational.length > 0 && (
                  <details className="informational-block">
                    <summary>
                      {informational.length} informational message
                      {informational.length === 1 ? '' : 's'} (blue flags)
                    </summary>
                    <p className="panel-note">
                      A blue flag says a faster car is approaching — information handed to a
                      driver, not a finding about them, so it is kept out of the list above.
                    </p>
                    <ul className="reason-list">
                      {informational.map((r, i) => (
                        <li key={`${r.lap}-${i}`}>
                          {r.lap ? <span className="mono">L{r.lap} </span> : null}
                          {r.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2>Flagged laps</h2>
                  <p className="panel-note">
                    Laps at least {doc.thresholds.slowLapS}s slower than this driver's own
                    median green-flag lap, with whatever race control published about the
                    track alongside.
                  </p>
                  <Method>
                    A yellow is a reason for a slow lap that has nothing to do with the
                    driver. Laps run under a safety car or red flag are excluded using the
                    published track-status messages —{' '}
                    <span className="mono">{doc.neutralisedLaps.length}</span> lap
                    {doc.neutralisedLaps.length === 1 ? '' : 's'} in this race.
                  </Method>
                </div>

                {flagged.length === 0 ? (
                  <p className="panel-note">
                    No lap ran far enough off this driver's own pace to flag.
                  </p>
                ) : (
                  <div className="table-scroll table-wide">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col" className="tabular">Lap</th>
                          <th scope="col" className="tabular">Lap time</th>
                          <th scope="col" className="tabular">Their median</th>
                          <th scope="col" className="tabular">Estimated loss</th>
                          <th scope="col">Severity</th>
                          <th scope="col">Published on this lap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flagged.map((f) => (
                          <tr key={f.lap}>
                            <td className="tabular">{f.lap}</td>
                            <td className="tabular">{formatLapTime(f.lapTimeS)}</td>
                            <td className="tabular">{formatLapTime(f.baselineS)}</td>
                            <td className="tabular loss-cell">{formatDelta(f.estimatedLossS)}</td>
                            <td>
                              <span className={`tag tag-${f.severity}`}>{f.severity}</span>
                            </td>
                            <td>
                              {(f.trackFlags ?? []).length === 0 ? (
                                <span className="legend-fullname">nothing</span>
                              ) : (
                                f.trackFlags.map((entry, i) => (
                                  <span key={`${entry.flag}-${i}`} className="track-flag">
                                    <span className="mono">{entry.flag}</span>
                                    {entry.sector ? ` · sector ${entry.sector}` : ''}
                                  </span>
                                ))
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>What this review does not cover</h2>
            </div>
            <ul className="reason-list">
              {doc.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <RelatedLinks
            context={`Each link opens on round ${round} rather than its own default.`}
            links={relatedLinks(['/strategy', '/whatif', '/lines', '/circuits'], {
              round,
              session: 'R',
              circuit: circuitForRound(season.data?.calendar, round),
            })}
          />
        </>
      )}
    </section>
  );
}
