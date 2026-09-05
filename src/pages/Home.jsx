import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dataPath } from '../lib/dataPath.js';
import { GROUPS } from '../lib/modules.js';

// The front door. The site had none: it opened on a championship table
// with no statement of what it is, what it refuses to do, or where the
// numbers come from — which for a project whose whole argument is about
// provenance was the wrong first impression.
//
// Every figure on this page is read from a published artifact at load
// time rather than written into the copy. A hardcoded "12 rounds" would
// be wrong the week after the next race, and a landing page that lies
// about its own scale is a bad advertisement for one about honesty.
//
// The module list is imported rather than declared here: it was
// duplicated between this page and the nav, and the two had already
// drifted apart.


export default function Home() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const grab = (path) =>
      fetch(dataPath(path)).then((res) => (res.ok ? res.json() : null)).catch(() => null);

    Promise.all([
      grab('season.json'),
      grab('2026/telemetry.json'),
      grab('2026/refusals.json'),
    ]).then(([season, telemetry, refusals]) => {
      if (cancelled) return;
      const today = new Date().toISOString().slice(0, 10);
      const run = (season?.calendar ?? []).filter((r) => r.date <= today);
      const sessions = Object.values(telemetry?.rounds ?? {})
        .flatMap((entry) => Object.values(entry))
        .filter((entry) => (entry.drivers?.length ?? 0) > 0);
      const whatif = (refusals?.groups ?? []).find((g) => g.module === 'What-If Engine');

      setStats({
        rounds: run.length,
        drivers: (season?.entryList ?? []).length,
        sessions: sessions.length,
        lines: sessions.reduce((total, entry) => total + entry.drivers.length, 0),
        counterfactuals: whatif?.published ?? null,
        withheld: refusals?.totalRefused ?? null,
        generatedAt: season?.generated_at ?? null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Apex Lab</h1>
        <p className="page-sub">
          A 2026 Formula 1 season built from public data. Every derived number carries how it
          was derived; the ones that could not be stood behind were left out.
        </p>
      </header>

      {stats && (
        <div className="figure-grid">
          <div className="figure">
            <p className="figure-label">Rounds</p>
            <p className="figure-value mono">{stats.rounds}</p>
            <p className="figure-sample">races run and ingested</p>
          </div>
          <div className="figure">
            <p className="figure-label">Sessions with racing lines</p>
            <p className="figure-value mono">{stats.sessions}</p>
            <p className="figure-sample">{stats.lines} laps decoded from position telemetry</p>
          </div>
          {stats.counterfactuals != null && (
            <div className="figure">
              <p className="figure-label">Counterfactuals published</p>
              <p className="figure-value mono">{stats.counterfactuals}</p>
              <p className="figure-sample">driver-races the model reproduces within 1%</p>
            </div>
          )}
          {stats.withheld != null && (
            <div className="figure">
              <p className="figure-label">Figures withheld</p>
              <p className="figure-value mono">{stats.withheld}</p>
              <p className="figure-sample">
                <Link to="/refusals">computed, then refused</Link>
              </p>
            </div>
          )}
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>The rules it is built under</h2>
        </div>
        <ul className="reason-list">
          <li><strong>Real data only.</strong> An empty state beats a fabricated one.</li>
          <li>
            <strong>Every figure carries how it was derived.</strong> A slope ships its R²
            and its sample count.
          </li>
          <li>
            <strong>A model that cannot reproduce reality is not published.</strong> Within
            1%, or it is listed as refused.
          </li>
          <li>
            <strong>A flag is not an accusation.</strong> What race control recorded is kept
            apart from what this site merely noticed.
          </li>
          <li>
            <strong>Nothing is recalled from memory.</strong> Where a constant would have to
            be remembered, the module says so and stops.
          </li>
        </ul>
      </section>

      {GROUPS.map((group) => (
        <section className="panel" key={group.id}>
          <div className="panel-head">
            <h2>{group.name}</h2>
          </div>
          <ul className="module-grid">
            {group.items.map((module) => (
              <li key={module.to}>
                <Link to={module.to} className="module-card">
                  <span className="module-name">{module.name}</span>
                  <span className="module-line">{module.line}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {stats?.generatedAt && (
        <p className="panel-note mono">
          data generated {stats.generatedAt} · {stats.drivers} drivers on the entry list
        </p>
      )}
    </section>
  );
}
