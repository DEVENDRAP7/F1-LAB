import { HashRouter, Navigate, Routes, Route, useSearchParams } from 'react-router-dom';
import Home from './pages/Home.jsx';
import SeasonLedger from './pages/SeasonLedger.jsx';
import CircuitAtlas from './pages/CircuitAtlas.jsx';
import DrivenLaps from './pages/DrivenLaps.jsx';
import RaceStrategy from './pages/RaceStrategy.jsx';
import UpcomingBrief from './pages/UpcomingBrief.jsx';
import RaceRecord from './pages/RaceRecord.jsx';
import Aerodynamics from './pages/Aerodynamics.jsx';
import WhatIf from './pages/WhatIf.jsx';
import Qualifying from './pages/Qualifying.jsx';
import Sprint from './pages/Sprint.jsx';
import Refusals from './pages/Refusals.jsx';
import AppNav from './components/AppNav.jsx';
import { LEGACY_PATHS } from './lib/modules.js';

// Six pages became three — see components/ViewTabs.jsx for why — and the
// six old paths are all still live, because a link that has been shared
// or bookmarked is not this project's to break. Each one lands on the
// view it used to be, carrying whatever round, session or driver it was
// carrying, and replaces itself in history so the back button still goes
// back to where the reader came from rather than bouncing off the
// redirect.
function LegacyRoute({ to, view }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  if (view) next.set('view', view);
  const query = next.toString();
  return <Navigate to={query ? `${to}?${query}` : to} replace />;
}

// HashRouter, not BrowserRouter: GitHub Pages has no server-side rewrite,
// so deep links must live entirely in the URL fragment.
export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <AppNav />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/ledger" element={<SeasonLedger />} />
            <Route path="/circuits" element={<CircuitAtlas />} />
            <Route path="/strategy" element={<RaceStrategy />} />
            <Route path="/lines" element={<DrivenLaps />} />
            <Route path="/qualifying" element={<Qualifying />} />
            <Route path="/sprint" element={<Sprint />} />
            <Route path="/record" element={<RaceRecord />} />
            <Route path="/aero" element={<Aerodynamics />} />
            <Route path="/whatif" element={<WhatIf />} />
            <Route path="/upcoming" element={<UpcomingBrief />} />
            <Route path="/refusals" element={<Refusals />} />

            {Object.entries(LEGACY_PATHS).map(([from, { to, view }]) => (
              <Route key={from} path={from} element={<LegacyRoute to={to} view={view} />} />
            ))}
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
