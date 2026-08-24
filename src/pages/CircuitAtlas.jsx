import { useEffect, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';

// M1 — Circuit Atlas. Track outline, corners and DRS zones are all
// derived at build time from real position telemetry (docs/SPEC.md); this
// page renders config/circuits/{key}.json artifacts and nothing else.
export default function CircuitAtlas() {
  const [state, setState] = useState({ status: 'loading', season: null });

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((season) => {
        if (!cancelled) setState({ status: 'ready', season });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'empty', season: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <EmptyState title="Loading calendar…" reason="Fetching public/data/season.json." />;
  }

  if (state.status === 'empty') {
    return (
      <EmptyState
        title="No circuits published yet"
        reason="Track geometry is derived from a qualifying lap's position telemetry, which only the Formula 1 live-timing service publishes. That host returns 403 to every request from a datacenter IP, so the build runner cannot fetch it and no circuit has been exported. The probe behind that finding is pipeline/diagnose_sources.py. Nothing is drawn from memory or estimated in its place."
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Circuit Atlas</h1>
        <p className="page-sub">
          The {state.season.year} calendar. Track geometry per circuit is not available —
          see below.
        </p>
        <p className="mono generated-at">generated {state.season.generated_at}</p>
      </header>

      <section className="panel panel-limitations">
        <h2>Why no track maps</h2>
        <p className="panel-note">
          A circuit outline here would be traced from a real qualifying lap's position
          telemetry, corner by corner. That channel exists only on the Formula 1
          live-timing service, which answers <span className="mono">403</span> to every
          request from a datacenter IP — including its own root and a prior season, so it
          is the network origin being refused rather than anything about this season. The
          runner that builds this site cannot reach it.
        </p>
        <p className="panel-note">
          Drawing approximate outlines from memory or from a generic map would be quicker
          and would look finished. It would also be invented, so the calendar below lists
          what is real — dates and venues from the results API — and stops there.
        </p>
      </section>

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
    </section>
  );
}
