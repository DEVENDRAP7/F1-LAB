import { useState } from 'react';

// M4 undercut/overcut ledger. Each row is one stop measured against one
// rival who was close and had not yet stopped: how the gap stood before,
// how it stood once both had stopped, and the difference.
//
// The sign is the whole point, so it gets the only colour on the row —
// and never colour alone: the number carries its own +/- and the
// direction is spelled out in the header. Rows whose window looked
// neutralised are marked and pushed behind a toggle rather than deleted,
// because "the safety car came out" is a real finding about the stop,
// just not a measurement of it.

function Net({ seconds }) {
  const gained = seconds > 0;
  return (
    <span className={gained ? 'net-gain' : 'net-loss'}>
      {gained ? '+' : ''}
      {seconds.toFixed(2)}s
    </span>
  );
}

export default function UndercutLedger({ undercuts, excluded, driverFilter }) {
  const [showNeutralised, setShowNeutralised] = useState(false);

  const filtered = undercuts.filter(
    (e) =>
      !driverFilter ||
      driverFilter.size === 0 ||
      driverFilter.has(e.driverId) ||
      driverFilter.has(e.rivalId),
  );
  const clean = filtered.filter((e) => !e.neutralisedWindow);
  const neutralised = filtered.filter((e) => e.neutralisedWindow);
  const rows = showNeutralised ? filtered : clean;

  const excludedTotal = Object.values(excluded ?? {}).reduce((a, b) => a + b, 0);

  if (filtered.length === 0) {
    return (
      <p className="panel-note">
        No stop in this race had a rival close enough, and stopping late enough, to measure
        an undercut against.
      </p>
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Net time gained or lost per pit stop against rivals who stopped later
          </caption>
          <thead>
            <tr>
              <th scope="col" className="tabular">Lap</th>
              <th scope="col">Stopper</th>
              <th scope="col">Rival</th>
              <th scope="col" className="tabular">Rival stopped</th>
              <th scope="col" className="tabular">Gap before</th>
              <th scope="col" className="tabular">Gap after</th>
              <th scope="col" className="tabular">Net to stopper</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={`${e.driverId}-${e.stop}-${e.rivalId}`}
                className={e.neutralisedWindow ? 'is-muted' : ''}
              >
                <td className="tabular">{e.stopLap}</td>
                <td className="mono">{e.driverId}</td>
                <td className="mono">{e.rivalId}</td>
                <td className="tabular">{e.rivalStopLap}</td>
                <td className="tabular">{e.gapBeforeS.toFixed(2)}s</td>
                <td className="tabular">{e.gapAfterS.toFixed(2)}s</td>
                <td className="tabular">
                  <Net seconds={e.netS} />
                  {e.neutralisedWindow && (
                    <span className="tag tag-quiet" title="Field median lap time in this window was well above the race median">
                      neutralised
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ledger-footnotes">
        <p className="chart-caption">
          Gap is the difference in elapsed race time, so positive means the stopper is
          ahead. <strong>Net</strong> is how that gap moved across the stop: positive means
          the stopper came out better off than they went in. It measures what happened, not
          what would have happened had they stayed out.
        </p>
        {neutralised.length > 0 && (
          <button
            type="button"
            className="link-button"
            onClick={() => setShowNeutralised((v) => !v)}
            aria-expanded={showNeutralised}
          >
            {showNeutralised ? 'Hide' : 'Show'} {neutralised.length} comparison
            {neutralised.length === 1 ? '' : 's'} made during a slowed field
          </button>
        )}
        {excludedTotal > 0 && (
          <p className="chart-caption">
            <span className="mono">{excludedTotal}</span> further pairings were excluded
            because the window could not be about the stop:{' '}
            {Object.entries(excluded)
              .filter(([, n]) => n > 0)
              .map(([reason, n]) => `${n} ${reason.replace(/_/g, ' ')}`)
              .join(', ')}
            .
          </p>
        )}
      </div>
    </>
  );
}
