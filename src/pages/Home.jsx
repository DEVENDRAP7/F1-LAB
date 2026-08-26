import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dataPath } from '../lib/dataPath.js';

// The front door. The site had none: it opened on a championship table
// with no statement of what it is, what it refuses to do, or where the
// numbers come from — which for a project whose whole argument is about
// provenance was the wrong first impression.
//
// Every figure on this page is read from a published artifact at load
// time rather than written into the copy. A hardcoded "12 rounds" would
// be wrong the week after the next race, and a landing page that lies
// about its own scale is a bad advertisement for one about honesty.

const MODULES = [
  {
    to: '/ledger',
    name: 'Season Ledger',
    line: 'The championship, accumulated independently and cross-checked against the published table.',
  },
  {
    to: '/circuits',
    name: 'Circuit Atlas',
    line: 'Outlines traced from real laps, with detected turns, gear, braking point and elevation.',
  },
  {
    to: '/strategy',
    name: 'Race Strategy',
    line: 'Stints by real compound, an undercut ledger, and per-stint pace fits with their R².',
  },
  {
    to: '/lines',
    name: 'Racing Lines',
    line: 'Driven laps overlaid, colourable by any published channel, with a mini-sector dominance map.',
  },
  {
    to: '/qualifying',
    name: 'Qualifying',
    line: 'Team-mate head to head — the one comparison where the car is held constant.',
  },
  {
    to: '/errors',
    name: 'Error Review',
    line: 'What race control recorded, kept strictly apart from what this site merely noticed.',
  },
  {
    to: '/style',
    name: 'Driving Style',
    line: 'How a lap was driven rather than how quick it was. There is no better column.',
  },
  {
    to: '/aero',
    name: 'Aero Explainer',
    line: 'Cornering load computed from the driven line: a g-g diagram and grip against speed.',
  },
  {
    to: '/whatif',
    name: 'What-If Engine',
    line: 'Replay a race on a different strategy — only where the model reproduces the real one.',
  },
  {
    to: '/upcoming',
    name: 'Upcoming',
    line: 'Priors from past editions of the next circuit, each with the sample behind it.',
  },
  {
    to: '/refusals',
    name: 'Refusals',
    line: 'Everything computed and then withheld, with the number that made the decision.',
  },
];

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
          A 2026 Formula 1 season built from public data, where every derived number carries
          the way it was derived — and the ones that could not be stood behind were left out
          on purpose.
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
          <li>
            <strong>Real data only.</strong> No invented lap times, no synthetic telemetry,
            no plausible-looking gaps. An empty state beats a fabricated one, and the site
            says which it is showing.
          </li>
          <li>
            <strong>Every derived figure ships with how it was derived.</strong> A
            degradation slope carries its R² and sample count; a position unit carries the
            measurement it came from; a modelled race time carries the error it was checked
            against.
          </li>
          <li>
            <strong>A model that cannot reproduce reality is not published.</strong> The
            what-if engine appears only for drivers whose real race it replays within 1%.
            The rest are listed with their error.
          </li>
          <li>
            <strong>A flag is not an accusation.</strong> The error review keeps what race
            control published strictly apart from what this site merely observed, and never
            diagnoses a cause.
          </li>
          <li>
            <strong>Nothing is recalled from memory.</strong> Season facts are fetched.
            Where a constant would have to be remembered — the 2026 aero regulations, the
            meaning of the DRS codes — the module says so and stops.
          </li>
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>What is in it</h2>
        </div>
        <ul className="module-grid">
          {MODULES.map((module) => (
            <li key={module.to}>
              <Link to={module.to} className="module-card">
                <span className="module-name">{module.name}</span>
                <span className="module-line">{module.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {stats?.generatedAt && (
        <p className="panel-note mono">
          data generated {stats.generatedAt} · {stats.drivers} drivers on the entry list
        </p>
      )}
    </section>
  );
}
