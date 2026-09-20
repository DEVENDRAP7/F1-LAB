import { lazy, Suspense } from 'react';
import AeroMeasured from './AeroExplainer.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ViewTabs, { useViewTabs } from '../components/ViewTabs.jsx';
import { viewsOf } from '../lib/modules.js';

// Two pages that ran the same arithmetic, under one heading.
//
// The Aero Explainer computed lateral and longitudinal acceleration from
// a driven lap; the Aero Rig drew a car and put the SAME quantities —
// from scripts/aero_export.mjs, which calls the same src/lib/aero.js —
// around it. Both asked for a round, a session and a driver first. A
// reader who wanted the load figure and the shape it acts on picked the
// same three things twice, on two pages that could only ever disagree by
// being out of step with each other.
//
// three.js is still a separate chunk. It is reached by the lazy import
// below rather than by a lazy route, which means the measured view — the
// one this page opens on — no longer pays for the 3D viewer at all,
// where the old /aero-rig route fetched it the moment it was entered.
const AeroCar = lazy(() => import('./AeroRig.jsx'));

const VIEWS = viewsOf('/aero');

export default function Aerodynamics() {
  const [view, setView] = useViewTabs(VIEWS);
  const active = VIEWS.find((v) => v.key === view);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Aerodynamics</h1>
        <p className="page-sub">{active.line}</p>
        <ViewTabs views={VIEWS} value={view} onChange={setView} label="Aerodynamics view" />
      </header>

      {view === 'rig' ? (
        <Suspense
          fallback={
            <EmptyState
              title="Loading the rig…"
              reason="Fetching the 3D viewer, a separate chunk from the rest of the site."
            />
          }
        >
          <AeroCar />
        </Suspense>
      ) : (
        <AeroMeasured />
      )}
    </section>
  );
}
