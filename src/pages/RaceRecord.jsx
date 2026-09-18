import ErrorReviewView from './ErrorReview.jsx';
import TeamRadioView from './TeamRadio.jsx';
import ViewTabs, { useViewTabs } from '../components/ViewTabs.jsx';
import { viewsOf } from '../lib/modules.js';

// What a race weekend left on the record, other than times.
//
// Error Review and Team Radio were separate pages that took the same two
// selections — a round and a driver — and read the same weekend from two
// feeds: what race control published, and which messages the broadcast
// chose to air. A reader looking at a flagged lap 34 and wanting to know
// whether there was a radio clip on lap 34 had to re-pick both.
//
// The two views keep their separate refusals, because they are different
// refusals: the incidents view never says why a lap was slow, and the
// radio view never says what was said. Neither is weakened by sharing a
// heading, and each still states its own in its own words below.
const VIEWS = viewsOf('/record');

export default function RaceRecord() {
  const [view, setView] = useViewTabs(VIEWS);
  const active = VIEWS.find((v) => v.key === view);

  return (
    <section className="page">
      <header className="page-head">
        <h1>Race Record</h1>
        <p className="page-sub">{active.line}</p>
        <ViewTabs views={VIEWS} value={view} onChange={setView} label="Race record view" />
      </header>

      {view === 'radio' ? <TeamRadioView /> : <ErrorReviewView />}
    </section>
  );
}
