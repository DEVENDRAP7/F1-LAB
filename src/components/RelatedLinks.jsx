import { Link } from 'react-router-dom';
import { withParams } from '../lib/urlState.js';

// Every page here answers one question about a race weekend, which means the
// interesting move is nearly always the next question about the *same* weekend.
// Before this existed, following that thought meant landing on another page's
// default round and re-picking — so the links carry the selection with them.
//
// A link with nothing to carry is dropped rather than shown: landing on
// another page's default is exactly the thing this is here to stop, and a link
// that silently does it is worse than no link, because it looks like it worked.
export default function RelatedLinks({ context, links }) {
  const usable = (links ?? []).filter(
    (link) => link && link.to && Object.values(link.params ?? {}).some((v) => v !== '' && v != null),
  );
  if (usable.length === 0) return null;

  return (
    <section className="panel related-panel">
      <div className="panel-head">
        <h2>Same weekend, other questions</h2>
        {context && <p className="panel-note">{context}</p>}
      </div>
      <ul className="related-links">
        {usable.map((link) => (
          <li key={`${link.to}:${link.label}`}>
            <Link className="related-link" to={withParams(link.to, link.params ?? {})}>
              <span className="related-link-name">{link.label}</span>
              <span className="related-link-note">{link.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
