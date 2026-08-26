import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import SeasonLedger from './pages/SeasonLedger.jsx';
import CircuitAtlas from './pages/CircuitAtlas.jsx';
import RacingLines from './pages/RacingLines.jsx';
import RaceStrategy from './pages/RaceStrategy.jsx';
import UpcomingBrief from './pages/UpcomingBrief.jsx';
import ErrorReview from './pages/ErrorReview.jsx';
import AeroExplainer from './pages/AeroExplainer.jsx';
import WhatIf from './pages/WhatIf.jsx';
import Qualifying from './pages/Qualifying.jsx';
import DrivingStyle from './pages/DrivingStyle.jsx';

// HashRouter, not BrowserRouter: GitHub Pages has no server-side rewrite,
// so deep links must live entirely in the URL fragment.
export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <nav className="app-nav">
          <NavLink to="/">Season Ledger</NavLink>
          <NavLink to="/circuits">Circuit Atlas</NavLink>
          <NavLink to="/strategy">Race Strategy</NavLink>
          <NavLink to="/lines">Racing Lines</NavLink>
          <NavLink to="/qualifying">Qualifying</NavLink>
          <NavLink to="/errors">Error Review</NavLink>
          <NavLink to="/style">Driving Style</NavLink>
          <NavLink to="/aero">Aero</NavLink>
          <NavLink to="/whatif">What-If</NavLink>
          <NavLink to="/upcoming">Upcoming</NavLink>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<SeasonLedger />} />
            <Route path="/circuits" element={<CircuitAtlas />} />
            <Route path="/strategy" element={<RaceStrategy />} />
            <Route path="/lines" element={<RacingLines />} />
            <Route path="/qualifying" element={<Qualifying />} />
            <Route path="/errors" element={<ErrorReview />} />
            <Route path="/style" element={<DrivingStyle />} />
            <Route path="/aero" element={<AeroExplainer />} />
            <Route path="/whatif" element={<WhatIf />} />
            <Route path="/upcoming" element={<UpcomingBrief />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
