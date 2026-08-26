import { useEffect, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';

// The ledger of everything this site declined to publish.
//
// Every module here refuses something, and each of those decisions is
// recorded in the artifact it belongs to — which means nobody ever sees
// them together. This is the one page that does, because the refusals
// are the part of this project worth looking at: a dashboard that cannot
// say no will fill every gap with something plausible, and a reader has
// no way to tell which numbers those are.
//
// It is deliberately not an apology. A refused figure is a decision that
// went the right way, and the counts are shown beside what was published
// so the ratio is visible rather than implied.

export default function Refusals() {
  const [doc, setDoc] = useState({ status: 'loading', data: null });

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('2026/refusals.json'))
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

  if (doc.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/2026/refusals.json." />;
  }

  if (doc.status === 'empty') {
    return (
      <EmptyState
        title="No ledger written yet"
        reason="The refusal ledger is gathered at the end of each refresh, from the artifacts that refresh wrote."
      />
    );
  }

  const { groups, totalRefused, note } = doc.data;

  return (
    <section className="page">
      <header className="page-head">
        <h1>What this site would not publish</h1>
        <p className="page-sub">
          Every module here refuses something. {totalRefused} figures were computed and
          then withheld, each with the number that made the decision.
        </p>
      </header>

      <div className="warning-banner" role="note">
        <strong>This page is not an apology.</strong> A dashboard that cannot say no fills
        every gap with something plausible, and a reader has no way to tell which numbers
        those are. Everything below was computable — a race total, a compound, a
        degradation slope, an elevation profile — and was left out because it did not clear
        the bar the module states. The counts sit beside what was published, so the ratio
        is visible rather than implied.
      </div>

      {groups.map((group) => (
        <section className="panel" key={group.module}>
          <div className="panel-head">
            <h2>{group.module}</h2>
            <p className="panel-note">{group.rule}</p>
          </div>

          <div className="figure-grid">
            <div className="figure">
              <p className="figure-label">Refused</p>
              <p className="figure-value mono">{group.refused}</p>
              <p className="figure-sample">withheld, with the reason recorded</p>
            </div>
            {group.published != null && (
              <div className="figure">
                <p className="figure-label">Published</p>
                <p className="figure-value mono">{group.published}</p>
                <p className="figure-sample">cleared the bar and shipped</p>
              </div>
            )}
          </div>

          <ul className="reason-list">
            {group.entries.map((entry) => (
              <li key={`${entry.scope}-${entry.reason}`}>
                <span className="mono">{entry.scope}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="panel panel-limitations">
        <div className="panel-head">
          <h2>About this ledger</h2>
        </div>
        <ul className="reason-list">
          <li>{note}</li>
          <li>
            It is gathered at the end of each refresh, over the tree that refresh just
            wrote, so it reports what was actually published rather than what was intended.
          </li>
          <li>
            The two hard gates that never reach this page are the ones that stop a build
            instead: a standings figure that disagrees with the published table, and a
            qualifying lap whose telemetry time disagrees with the official result by more
            than a hundredth. Those do not get withheld — they fail the deploy.
          </li>
        </ul>
      </section>
    </section>
  );
}
