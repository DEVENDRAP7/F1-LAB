import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { GROUPS, groupOf } from '../lib/modules.js';

// The header bar.
//
// It replaces a flat row of fifteen links. That row was wider than the
// viewport at every width the site is used at, and it lived in an
// overflow-x container with no scrollbar and no edge fade, so five of
// the fifteen pages had no visible way in at all — including the two
// newest ones. Grouping is not decoration here; it is the difference
// between a page being reachable and not.
//
// Opening is on click rather than hover: a hover menu is unusable on a
// touchscreen, and this site is read on phones.
export default function AppNav() {
  const [open, setOpen] = useState(null);
  const { pathname } = useLocation();
  const bar = useRef(null);
  const here = groupOf(pathname);

  // Close on navigation, on Escape, and on a click landing outside.
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => e.key === 'Escape' && setOpen(null);
    const away = (e) => !bar.current?.contains(e.target) && setOpen(null);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', away);
    };
  }, [open]);

  return (
    <header className="app-bar" ref={bar}>
      <Link className={`brand${pathname === '/' ? ' is-here' : ''}`} to="/">
        Apex<span>Lab</span>
      </Link>
      <nav className="app-nav" aria-label="Sections">
        {GROUPS.map((g) => (
          <div className="nav-group" key={g.id}>
            <button
              type="button"
              className={`nav-trigger${here === g.id ? ' is-here' : ''}${open === g.id ? ' is-open' : ''}`}
              aria-expanded={open === g.id}
              onClick={() => setOpen(open === g.id ? null : g.id)}
            >
              <span className="nav-label-full">{g.name}</span>
              <span className="nav-label-short">{g.short ?? g.name}</span>
              <svg viewBox="0 0 10 6" aria-hidden="true" className="nav-chevron">
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
            {open === g.id && (
              <div className="nav-menu">
                {g.items.map((i) => (
                  <NavLink to={i.to} key={i.to} className="nav-item">
                    <span className="nav-item-name">{i.name}</span>
                    <span className="nav-item-line">{i.line}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </header>
  );
}
