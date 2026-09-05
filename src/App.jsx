import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import SeasonLedger from './pages/SeasonLedger.jsx';
import CircuitAtlas from './pages/CircuitAtlas.jsx';
import RacingLines from './pages/RacingLines.jsx';
import RaceStrategy from './pages/RaceStrategy.jsx';
import UpcomingBrief from './pages/UpcomingBrief.jsx';
import ErrorReview from './pages/ErrorReview.jsx';
import AeroExplainer from './pages/AeroExplainer.jsx';
import WhatIf from './pages/WhatIf.jsx';
import Qualifying from './pages/Qualifying.jsx';
import Sprint from './pages/Sprint.jsx';
import TeamRadio from './pages/TeamRadio.jsx';
import DrivingStyle from './pages/DrivingStyle.jsx';
import Refusals from './pages/Refusals.jsx';
import EmptyState from './components/EmptyState.jsx';
import AppNav from './components/AppNav.jsx';

// three.js is a heavy, WebGL-only dependency that only the Aero Rig
// needs, so its whole page is a separate chunk fetched on first visit
// rather than weight every other page carries on load.
const AeroRig = lazy(() => import('./pages/AeroRig.jsx'));

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
            <Route path="/lines" element={<RacingLines />} />
            <Route path="/qualifying" element={<Qualifying />} />
            <Route path="/sprint" element={<Sprint />} />
            <Route path="/errors" element={<ErrorReview />} />
            <Route path="/radio" element={<TeamRadio />} />
            <Route path="/style" element={<DrivingStyle />} />
            <Route path="/aero" element={<AeroExplainer />} />
            <Route
              path="/aero-rig"
              element={
                <Suspense
                  fallback={
                    <EmptyState
                      title="Loading the rig…"
                      reason="Fetching the 3D viewer, a separate chunk from the rest of the site."
                    />
                  }
                >
                  <AeroRig />
                </Suspense>
              }
            />
            <Route path="/whatif" element={<WhatIf />} />
            <Route path="/upcoming" element={<UpcomingBrief />} />
            <Route path="/refusals" element={<Refusals />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
