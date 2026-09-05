import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import EmptyState from '../components/EmptyState.jsx';
import RelatedLinks from '../components/RelatedLinks.jsx';
import { circuitForRound, relatedLinks } from '../lib/relatedLinks.js';
import { useUrlState } from '../lib/urlState.js';
import StrategyEditor from '../components/StrategyEditor.jsx';
import OutcomeChart from '../components/OutcomeChart.jsx';
import { monteCarlo, median } from '../lib/whatifModel.js';
import { sensitivity } from '../lib/sensitivity.js';
import { formatDuration, formatDelta } from '../lib/formatTime.js';
import { driverIndex, driverCode, driverName } from '../lib/driverNames.js';
import { Limitations, Method } from '../components/Disclosure.jsx';

// M5 — the What-If engine.
//
// The language rule from docs/SPEC.md governs every string on this page:
// a counterfactual is labelled as a model, never as an outcome. "The
// model estimates 3.2s" is publishable; "he would have finished P3" is
// not, and this page cannot say it even by accident, because it never
// computes a position. It has no traffic model, no rivals, and no way to
// know what anyone else would have done differently — so it reports a
// race time and the spread around it, and nothing about the order.
//
// The other rule is the gate. A driver is only offered here if replaying
// their real strategy reproduces their real race time within 1%. Drivers
// who fail that check are listed with the error rather than hidden: the
// interesting fact about them is that the model does not describe their
// race.

// A percentage that has been rounded to zero should not carry a sign:
// "-0.00%" reads as a real negative and is just a rounded nothing.
// A delta under a minute reads as seconds and wants the unit; past a
// minute formatDelta switches to M:SS.mmm, where an "s" would be wrong.
function formatSecondsDelta(seconds) {
  const text = formatDelta(seconds);
  return Math.abs(seconds) < 60 ? `${text}s` : text;
}

function formatPercent(value, decimals = 2) {
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toFixed(decimals)}%`;
}

// A compound the pipeline could not identify is carried as a per-stint
// placeholder. It is still a real stint with a real fitted slope, so it
// stays selectable — but it is labelled as the unknown it is.
function compoundLabel(compound) {
  if (!compound.startsWith('UNKNOWN-')) return compound;
  const stint = compound.split('-').pop();
  return `unidentified (stint ${stint})`;
}

const PERCENTILE_LOW = 0.1;
const PERCENTILE_HIGH = 0.9;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarise(totals) {
  const sorted = [...totals].sort((a, b) => a - b);
  return {
    median: median(totals),
    low: percentile(sorted, PERCENTILE_LOW),
    high: percentile(sorted, PERCENTILE_HIGH),
  };
}

export default function WhatIf() {
  const [season, setSeason] = useState({ status: 'loading', data: null });
  const [round, setRound] = useUrlState('round');
  const [doc, setDoc] = useState({ status: 'idle', data: null });
  const [driverId, setDriverId] = useUrlState('driver');
  const [strategy, setStrategy] = useState(null);

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

  // Open on the newest round that actually has a validated driver. Four
  // of this season's races were red-flagged, and a red-flagged race
  // exports a reason instead of parameters — landing on one of those
  // would show an explanation where the module should be.
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
          const res = await fetch(dataPath(`2026/${candidate}/R/whatif.json`));
          if (!res.ok) continue;
          const payload = await res.json();
          if ((payload.validatedDrivers ?? 0) === 0) continue;
          if (!cancelled) setRound(String(candidate));
          return;
        } catch {
          // try the round before it
        }
      }
      if (!cancelled) setDoc({ status: 'empty', data: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [season, round]);

  useEffect(() => {
    if (!round) return undefined;
    let cancelled = false;
    setDoc({ status: 'loading', data: null });
    setStrategy(null);
    fetch(dataPath(`2026/${round}/R/whatif.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDoc({ status: 'ready', data });
        const validated = Object.entries(data.drivers ?? {})
          .filter(([, entry]) => entry.validation.validated)
          .map(([id]) => id)
          .sort();
        // A driver named in the URL keeps the selection across a round change
        // if this round validated them too; otherwise fall back to the first
        // rather than leaving the page pointed at nobody.
        setDriverId((current) => (validated.includes(current) ? current : validated[0] ?? ''));
      })
      .catch(() => {
        if (cancelled) return;
        setDoc({ status: 'empty', data: null });
        setDriverId('');
      });
    return () => {
      cancelled = true;
    };
  }, [round]);

  // Names come from the season entry list, never from slicing an id:
  // "arvid_lindblad".slice(0, 3) is "ARV", which is not anyone's code.
  const names = useMemo(() => driverIndex(season.data?.entryList ?? []), [season.data]);

  const entry = doc.data?.drivers?.[driverId] ?? null;

  // The editor opens on what the driver actually ran, so the first thing
  // a reader sees is the real race and every change is a change from it.
  useEffect(() => {
    if (!entry) {
      setStrategy(null);
      return;
    }
    setStrategy(entry.params.strategy.map((s) => ({ ...s })));
  }, [entry]);

  const compounds = useMemo(
    () => (entry ? Object.keys(entry.params.compounds) : []),
    [entry],
  );

  const actualRun = useMemo(() => {
    if (!entry) return null;
    return summarise(monteCarlo(entry.params));
  }, [entry]);

  // One Monte Carlo run per strategy, with the summary read off it. The
  // first version ran it twice — once for the tiles and again for the
  // histogram — so the number on the tile and the shape below it came
  // from different sets of runs.
  const totals = useMemo(() => {
    if (!entry || !strategy) return [];
    const covered = strategy.reduce((sum, s) => sum + s.laps, 0);
    if (covered !== entry.params.total_laps) return [];
    if (strategy.some((s) => !(s.compound in entry.params.compounds))) return [];
    try {
      return monteCarlo({ ...entry.params, strategy });
    } catch {
      // validateParams refuses anything the model cannot honestly run.
      return [];
    }
  }, [entry, strategy]);

  const modelled = useMemo(
    () => (totals.length > 0 ? summarise(totals) : null),
    [totals],
  );

  const swings = useMemo(
    () => (entry && strategy && modelled ? sensitivity({ ...entry.params, strategy }) : null),
    [entry, strategy, modelled],
  );

  const changed = useMemo(() => {
    if (!entry || !strategy) return false;
    const actual = entry.params.strategy;
    if (actual.length !== strategy.length) return true;
    return strategy.some(
      (s, i) => s.laps !== actual[i].laps || s.compound !== actual[i].compound,
    );
  }, [entry, strategy]);

  const pastRounds = useMemo(() => {
    if (!season.data) return [];
    const today = new Date().toISOString().slice(0, 10);
    return season.data.calendar.filter((r) => r.date <= today);
  }, [season.data]);

  if (season.status === 'loading') {
    return <EmptyState title="Loading…" reason="Fetching public/data/season.json." />;
  }

  const unvalidated = Object.entries(doc.data?.drivers ?? {})
    .filter(([, e]) => !e.validation.validated)
    .sort(([a], [b]) => a.localeCompare(b));
  const validated = Object.entries(doc.data?.drivers ?? {})
    .filter(([, e]) => e.validation.validated)
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="page">
      <header className="page-head">
        <h1>What-If Engine</h1>
        <p className="page-sub">
          Replay a race with a different strategy. Everything below is a model's estimate of
          race time — never a claim about where anyone would have finished.
        </p>
      </header>

      <div className="warning-banner" role="note">
        <strong>This is a model, and it is offered only where it works.</strong> It estimates
        a race time and says nothing about finishing position.
        <Method label="What that means">
          Its parameters are fitted to this race's own lap times, and a driver appears here
          only if replaying their real strategy reproduces their real race time to within
          1%. Even then it knows nothing about traffic, rivals, or a safety car falling in a
          different place.
        </Method>
      </div>

      {pastRounds.length > 0 && (
        <div className="controls-row">
          <label>
            Round{' '}
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              <option value="">Select a race…</option>
              {pastRounds.map((r) => (
                <option key={r.round} value={r.round}>
                  {String(r.round).padStart(2, '0')} · {r.raceName}
                </option>
              ))}
            </select>
          </label>
          {doc.data?.fit && (
            <span className="generated-at mono">
              fitted on {doc.data.fit.greenLaps} green laps · residual{' '}
              {doc.data.fit.residualRmsS.toFixed(2)}s
            </span>
          )}
        </div>
      )}

      {doc.status === 'loading' && <EmptyState title="Loading…" reason={`Fetching round ${round}.`} />}

      {doc.status === 'ready' && doc.data.skipped && (
        <EmptyState
          title="No model for this race"
          reason={`${doc.data.skipped
            .charAt(0)
            .toUpperCase()}${doc.data.skipped.slice(1)}.`}
        />
      )}

      {doc.status === 'ready' && !doc.data.skipped && validated.length === 0 && (
        <EmptyState
          title="No driver's race was reproduced closely enough"
          reason="Parameters were fitted for this round, but replaying each driver's real strategy missed their real race time by more than 1%, so the model has no standing to say what a different strategy would have done."
        />
      )}

      {validated.length > 0 && (
        <div className="driver-picker">
          {validated.map(([id, e]) => (
            <button
              key={id}
              type="button"
              className={`driver-chip${driverId === id ? ' is-on' : ''}`}
              onClick={() => setDriverId(id)}
            >
              <span className="mono">{driverCode(names, id)}</span>
              <span className="legend-fullname">{formatPercent(e.validation.errorPct)}</span>
            </button>
          ))}
        </div>
      )}

      {entry && strategy && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>What actually happened</h2>
              <p className="panel-note">
                {driverName(names, driverId)} ran {entry.params.strategy.length} stint
                {entry.params.strategy.length === 1 ? '' : 's'} over{' '}
                {entry.params.total_laps} laps in{' '}
                <span className="mono">{formatDuration(entry.actualTotalS)}</span>. Replaying
                that exact strategy, the model lands on{' '}
                <span className="mono">{formatDuration(actualRun.median)}</span> — off by{' '}
                <span className="mono">{formatPercent(entry.validation.errorPct)}</span>
                , which is what qualifies it to be run at all.
              </p>
            </div>
            <ul className="reason-list">
              <li>
                Measured pit loss{' '}
                <span className="mono">{entry.measured.pitLossS.toFixed(1)}s</span> per stop,
                from {entry.measured.stops} stop{entry.measured.stops === 1 ? '' : 's'} this
                driver actually made.
              </li>
              <li>
                Fuel and track evolution together{' '}
                <span className="mono">
                  {entry.params.fuel_effect_s_per_lap.toFixed(3)}s
                </span>{' '}
                per lap of fuel remaining. One race cannot separate the two, so the whole
                coefficient is published as fuel.
              </li>
              {entry.measured.neutralisedLapsRun > 0 ? (
                <li>
                  {entry.measured.neutralisedLapsRun} lap
                  {entry.measured.neutralisedLapsRun === 1 ? '' : 's'} run under a
                  neutralisation, each costing{' '}
                  <span className="mono">{entry.params.sc_lap_extra_s.toFixed(1)}s</span>{' '}
                  against green-flag pace. A different strategy is replayed against the same
                  neutralisations, on the same laps — the model cannot know a safety car
                  would have fallen anywhere else.
                </li>
              ) : (
                <li>
                  No lap of this race was neutralised, on the field's own pace. A strategy
                  built here is therefore a green-flag race throughout — which is also the
                  strongest assumption on the page, since one safety car changes the answer
                  entirely.
                </li>
              )}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Change the strategy</h2>
              <p className="panel-note">
                Degradation per compound, fitted from this race:{' '}
                {Object.entries(entry.params.compounds)
                  .map(([c, p]) => `${compoundLabel(c)} ${p.deg_rate_s_per_lap.toFixed(3)}s/lap`)
                  .join(' · ')}
                .
              </p>
              <Method>
                A stint on a compound this driver never ran is still a model of this race's
                tyres, but the further it is from what was run, the more of it is
                extrapolation.
              </Method>
            </div>
            <StrategyEditor
              strategy={strategy}
              totalLaps={entry.params.total_laps}
              compounds={compounds}
              labelFor={compoundLabel}
              onChange={setStrategy}
            />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>The model estimates</h2>
            </div>
            {!modelled ? (
              <p className="panel-note">
                Nothing to run yet — the stints have to add up to the race distance.
              </p>
            ) : (
              <>
                <div className="figure-grid">
                  <div className="figure">
                    <p className="figure-label">Modelled race time</p>
                    <p className="figure-value mono">{formatDuration(modelled.median)}</p>
                    <p className="figure-note mono">
                      {formatDuration(modelled.low)} – {formatDuration(modelled.high)} across
                      runs
                    </p>
                  </div>
                  <div className="figure">
                    <p className="figure-label">
                      {changed ? 'Against the real strategy' : 'Same as the real strategy'}
                    </p>
                    <p className="figure-value mono">
                      {formatSecondsDelta(modelled.median - actualRun.median)}
                    </p>
                    <p className="figure-note">
                      {changed
                        ? 'estimated, on this model, with everything else held as it was'
                        : 'this is the strategy that was run'}
                    </p>
                  </div>
                  <div className="figure">
                    <p className="figure-label">Against the real race time</p>
                    <p className="figure-value mono">
                      {formatSecondsDelta(modelled.median - entry.actualTotalS)}
                    </p>
                    <p className="figure-note">
                      includes the model's own {formatPercent(entry.validation.errorPct)}{' '}
                      error on this driver
                    </p>
                  </div>
                </div>
                <OutcomeChart totals={totals} actualS={entry.actualTotalS} />
                <p className="panel-note">
                  <span className="mono">{totals.length}</span> runs, reported as a
                  distribution rather than as a single number.
                </p>
              </>
            )}
          </section>
        </>
      )}

      {entry && swings && swings.rows.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>What the answer rests on</h2>
            <p className="panel-note">
              Each fitted number moved on its own to the edge of its uncertainty. A row that
              moves the race time by more than the difference you are reading is the row
              that decides the answer.
            </p>
          </div>
          <div className="table-scroll table-wide">
            <table>
              <thead>
                <tr>
                  <th scope="col">Input</th>
                  <th scope="col">Fitted value</th>
                  <th scope="col" className="tabular">At the low end</th>
                  <th scope="col" className="tabular">At the high end</th>
                </tr>
              </thead>
              <tbody>
                {swings.rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="mono">{row.detail}</td>
                    <td className="tabular">{formatSecondsDelta(row.low)}</td>
                    <td className="tabular">{formatSecondsDelta(row.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {unvalidated.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Drivers the model does not describe</h2>
            <p className="panel-note">
              Replaying these drivers' real strategies missed their real race time by more
              than 1%, so no counterfactual is offered. They are listed rather than hidden.
            </p>
          </div>
          <ul className="reason-list">
            {unvalidated.map(([id, e]) => (
              <li key={id}>
                {driverName(names, id)} —{' '}
                <span className="mono">{formatPercent(e.validation.errorPct)}</span>{' '}
                against a real race time of{' '}
                <span className="mono">{formatDuration(e.actualTotalS)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {doc.data?.limitations && (
        <Limitations title="What this model does not know">
          {doc.data.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            No rivals and no traffic. The model runs one car against the clock, so it
            cannot say whether a different strategy would have come out ahead of anyone —
            only how long the race would have taken on these parameters.
          </li>
        </Limitations>
      )}

      <RelatedLinks
        context={`Each link opens on round ${round} rather than its own default.`}
        links={relatedLinks(['/strategy', '/errors', '/lines', '/circuits'], {
          round,
          session: 'R',
          circuit: circuitForRound(season.data?.calendar, round),
        })}
      />
    </section>
  );
}
