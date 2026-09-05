import { Children } from 'react';

/* Progressive disclosure, on `<details>` rather than state.
 *
 * The site's argument is that every number shows its working, and the
 * way that was built was to print the working next to the number — so
 * each page carried three or four paragraphs of method before it showed
 * anything, and a full panel of caveats after. All of it true, none of
 * it readable: the method is what you want on the second look, not the
 * first.
 *
 * So the working stays, one click away. `<details>` because it is
 * keyboard-operable, announced correctly, searchable by the browser's
 * find-in-page in current engines, and needs no JavaScript to open. */
export function Disclosure({ summary, count, children, className = '' }) {
  return (
    <details className={`disclosure ${className}`.trim()}>
      <summary>
        <svg viewBox="0 0 10 6" aria-hidden="true" className="disclosure-chevron">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        {summary}
        {count != null && <span className="disclosure-count mono">{count}</span>}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

/** The method behind a figure: one line of trigger, the derivation inside. */
export function Method({ children, label = 'How this is computed' }) {
  return (
    <Disclosure summary={label} className="disclosure-method">
      {children}
    </Disclosure>
  );
}

/* What a page cannot say. Every page grew one of these as a panel of
 * long bullets at the foot, which is the right content in the wrong
 * place: it is a reference, not an introduction. The count is in the
 * summary so it is honest about how much is behind it. */
export function Limitations({ title = 'What this cannot tell you', children }) {
  return (
    <section className="panel panel-limitations">
      <Disclosure summary={title} count={Children.count(children)}>
        <ul className="reason-list">{children}</ul>
      </Disclosure>
    </section>
  );
}
