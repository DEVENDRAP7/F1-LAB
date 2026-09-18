import { useRef } from 'react';
import { useUrlState } from '../lib/urlState.js';

/* Two pages that needed the same three choices, folded into one.
 *
 * The nav carried fourteen entries, and several pairs of them asked a
 * reader for exactly the same selection — the same round, the same
 * session, the same driver — before showing two halves of one answer.
 * Racing Lines and Driving Style both decoded the same .bin files;
 * the Aero Explainer and the Aero Rig both ran the same arithmetic from
 * src/lib/aero.js; Error Review and Team Radio both read one round's
 * record of what happened. Picking a round on one and then picking it
 * again on the other is work the reader was doing for the nav's benefit.
 *
 * So those pairs are one page each with a tab strip, and the tab is the
 * only thing the strip changes: round, session and driver live in the
 * query string, so switching views keeps the selection rather than
 * resetting it. The tab lives in the query string too, which is what
 * makes a link to one view still a link to that view.
 *
 * The first view's key is the default and is left out of the URL, on the
 * same rule as every other selection here: a URL says what was changed.
 */

/* Which tab a ?view= names, and what to show when it names nothing.
 *
 * Pure, and separate from the hook, because this is the part that can be
 * wrong: a view key renamed here but not in lib/modules.js, or an old
 * link carrying a key that no longer exists, would otherwise render a
 * page with a tab strip and no content under it. Falling back to the
 * first view means a stale link lands somewhere real. */
export function resolveView(views, requested) {
  return views.some((v) => v.key === requested) ? requested : views[0].key;
}

export function useViewTabs(views) {
  const [view, setView] = useUrlState('view', views[0].key);
  return [resolveView(views, view), setView];
}

export default function ViewTabs({ views, value, onChange, label }) {
  const strip = useRef(null);

  // The tablist keyboard contract: one tab stop for the strip, arrows to
  // move within it. Without this a reader on a keyboard has to tab past
  // every view to reach the page.
  function onKeyDown(e) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = views.findIndex((v) => v.key === value);
    const next = views[(at + step + views.length) % views.length];
    onChange(next.key);
    strip.current?.querySelector(`#tab-${next.key}`)?.focus();
  }

  return (
    <div className="view-tabs" role="tablist" aria-label={label} ref={strip} onKeyDown={onKeyDown}>
      {views.map((v) => (
        <button
          type="button"
          role="tab"
          key={v.key}
          id={`tab-${v.key}`}
          className={`view-tab${v.key === value ? ' is-on' : ''}`}
          aria-selected={v.key === value}
          tabIndex={v.key === value ? 0 : -1}
          onClick={() => onChange(v.key)}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}
