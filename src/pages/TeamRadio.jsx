import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { circuitForRound, relatedLinks } from '../lib/relatedLinks.js';
import { useUrlState } from '../lib/urlState.js';

// Broadcast team radio — who was on it, when, and a link to the clip.
//
// Three things this page does not do, all of them refusals rather than
// gaps, and all three enforced by the validation gate rather than left
// to good intentions:
//
//   it hosts no audio      — the clips are someone else's recording and
//                            are linked where their publisher serves them
//   it transcribes nothing — a transcript generated here would be this
//                            project's paraphrase standing where a
//                            quotation belongs
//   it infers nothing      — not tone, not subject, not what a message
//                            says about anyone's race
//
// And the counts are broadcast selections, never a team's radio traffic.
// A driver with more clips is a driver television chose more often.

export default function TeamRadio() {
  const [doc, setDoc] = useState({ status: 'loading', data: null });
  const [season, setSeason] = useState(null);
  const [round, setRound] = useUrlState('round');
  const [driver, setDriver] = useUrlState('driver');

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('2026/radio.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDoc({ status: 'ready', data });
        const withRadio = (data.races ?? []).filter((r) => r.radio.published);
        const available = (withRadio.length ? withRadio : data.races ?? [])
          .map((r) => String(r.round));
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

  const race = useMemo(() => {
    if (!doc.data || !round) return null;
    return doc.data.races.find((r) => String(r.round) === round) ?? null;
  }, [doc.data, round]);

  const timeline = useMemo(() => {
    const clips = race?.radio?.timeline ?? [];
    return driver ? clips.filter((c) => c.driverCode === driver) : clips;
  }, [race, driver]);

  if (doc.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/2026/radio.json." />;
  }

  if (doc.status === 'empty') {
    return (
      <EmptyState
        title="No team radio published yet"
        reason="Team radio is released by the broadcast rather than by the teams, and the refresh has not found a race with enough clips to build a timeline from. Nothing is reconstructed to fill the gap."
      />
    );
  }

  const { races, limitations } = doc.data;

  return (
    <section className="page">
      <header className="page-head">
        <h1>Team Radio</h1>
        <p className="page-sub">
          Who was on the radio, when, and on which lap — with a link to the original clip.
        </p>
        <p className="mono generated-at">generated {doc.data.generated_at}</p>
      </header>

      <div className="warning-banner" role="note">
        <strong>Nothing here is transcribed, and nothing is inferred.</strong> This page
        records that a radio message exists, the lap it happened on, and where to hear it.
        It does not say what was said: a transcript produced here would be this project's
        paraphrase standing where a quotation belongs. It does not read tone, subject or
        mood either. And these are <em>broadcast selections</em> — only a limited part of
        the radio is released, so a driver with more clips is a driver television chose more
        often, not a driver who said more.
      </div>

      {races.length > 0 && (
        <div className="controls-row">
          <label>
            Round{' '}
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              {races.map((r) => (
                <option key={r.round} value={r.round}>
                  {String(r.round).padStart(2, '0')} · {r.raceName}
                  {r.radio.published ? '' : ' — no clips'}
                </option>
              ))}
            </select>
          </label>
          {race?.radio?.published && (
            <span className="generated-at mono">
              {race.radio.clips} clip{race.radio.clips === 1 ? '' : 's'} ·{' '}
              {race.radio.withLap} placed on a lap
            </span>
          )}
        </div>
      )}

      {race && !race.radio.published && (
        <EmptyState
          title={`No radio timeline for round ${round}`}
          reason={race.radio.withheldReason}
        />
      )}

      {race?.radio?.published && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Who the broadcast picked</h2>
              <p className="panel-note">
                Clips released per driver. Read it as a count of what went to air, because
                that is what it is.
              </p>
            </div>
            <div className="driver-picker">
              <button
                type="button"
                className={`driver-chip${driver ? '' : ' is-on'}`}
                onClick={() => setDriver('')}
              >
                <span className="mono">ALL</span>
                <span className="legend-fullname">{race.radio.clips}</span>
              </button>
              {race.radio.byDriver.map((row) => (
                <button
                  key={row.driverNumber}
                  type="button"
                  className={`driver-chip${driver === row.driverCode ? ' is-on' : ''}`}
                  onClick={() => setDriver(row.driverCode === driver ? '' : row.driverCode)}
                  disabled={!row.driverCode}
                >
                  <span className="mono">{row.driverCode ?? `#${row.driverNumber}`}</span>
                  <span className="legend-fullname">{row.clips}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>The timeline</h2>
              <p className="panel-note">
                In the order the clips were published. A message before the first recorded
                lap start carries no lap number rather than lap 1 — the grid and the
                formation lap are radio-heavy and are not racing.
              </p>
            </div>

            <div className="table-scroll table-wide is-full">
              <table>
                <caption className="visually-hidden">
                  {race.raceName}: broadcast radio clips in time order
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Driver</th>
                    <th scope="col" className="tabular">Lap</th>
                    <th scope="col" className="tabular">Time (UTC)</th>
                    <th scope="col">Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((clip) => (
                    <tr key={`${clip.date}:${clip.driverNumber}`}>
                      <th scope="row" className="mono">
                        {clip.driverCode ?? `#${clip.driverNumber}`}
                      </th>
                      <td className="tabular">{clip.lap ?? '—'}</td>
                      <td className="tabular">{(clip.date ?? '').slice(11, 19)}</td>
                      <td>
                        <a href={clip.recordingUrl} target="_blank" rel="noreferrer noopener">
                          listen at the source
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="chart-caption">
              Every link goes to the clip where its publisher serves it. No audio is copied
              into this site.
            </p>
          </section>
        </>
      )}

      <section className="panel panel-limitations">
        <div className="panel-head">
          <h2>What this page cannot tell you</h2>
        </div>
        <ul className="reason-list">
          {limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="panel-note mono">source: {doc.data.source}</p>
      </section>

      <RelatedLinks
        context={`Each link opens on round ${round} rather than its own default.`}
        links={relatedLinks(['/strategy', '/errors', '/whatif', '/lines', '/circuits'], {
          round,
          session: 'R',
          circuit: circuitForRound(season?.calendar, round),
        })}
      />
    </section>
  );
}
