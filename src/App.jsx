import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import SeasonLedger from './pages/SeasonLedger.jsx';
import CircuitAtlas from './pages/CircuitAtlas.jsx';

// HashRouter, not BrowserRouter: GitHub Pages has no server-side rewrite,
// so deep links must live entirely in the URL fragment.
export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <nav className="app-nav">
          <NavLink to="/">Season Ledger</NavLink>
          <NavLink to="/circuits">Circuit Atlas</NavLink>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<SeasonLedger />} />
            <Route path="/circuits" element={<CircuitAtlas />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
