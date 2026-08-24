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
        reason="season.json and circuits/{key}.json are written by pipeline/export.py from FastF1 session data. Nothing has been ingested yet — this environment cannot reach the FastF1/Jolpica-F1 endpoints, so the first real run happens in the refresh-data GitHub Actions workflow."
      />
    );
  }

  return (
    <section>
      <h1>Circuit Atlas</h1>
      <ul>
        {state.season.calendar.map((round) => (
          <li key={round.round}>
            {round.circuitName} — Round {round.round}
          </li>
        ))}
      </ul>
    </section>
  );
}
