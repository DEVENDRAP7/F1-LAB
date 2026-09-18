import RacingLinesView from './RacingLines.jsx';
import DrivingStyleView from './DrivingStyle.jsx';
import ViewTabs, { useViewTabs } from '../components/ViewTabs.jsx';
import { viewsOf } from '../lib/modules.js';

// Two views of one lap.
//
// Racing Lines and Driving Style were separate pages that fetched the
// same session manifest and decoded the same Int16 .bin files for the
// same drivers, then answered two halves of one question: where the lap
// went, and how it was driven. Reaching the second meant picking the
// round, the session and the drivers over again, and downloading the
// laps a second time.
//
// Both views are in the main bundle, so switching tabs costs a render
// rather than a request, and the selection stays in the query string
// where both of them already read it from.
const VIEWS = viewsOf('/lines');

export default function DrivenLaps() {
  const [view, setView] = useViewTabs(VIEWS);
  const active = VIEWS.find((v) => v.key === view);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Driven Laps</h1>
        <p className="page-sub">{active.line}</p>
        <ViewTabs views={VIEWS} value={view} onChange={setView} label="Driven laps view" />
      </header>

      {view === 'style' ? <DrivingStyleView /> : <RacingLinesView />}
    </section>
  );
}
