import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import SeasonLedger from './pages/SeasonLedger.jsx';
import CircuitAtlas from './pages/CircuitAtlas.jsx';
import RacingLines from './pages/RacingLines.jsx';
import RaceStrategy from './pages/RaceStrategy.jsx';

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
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<SeasonLedger />} />
            <Route path="/circuits" element={<CircuitAtlas />} />
            <Route path="/strategy" element={<RaceStrategy />} />
            <Route path="/lines" element={<RacingLines />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
