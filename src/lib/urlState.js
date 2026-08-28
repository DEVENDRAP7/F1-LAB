import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// Which round you are looking at is part of what the page is showing, so it
// belongs in the URL rather than in component state that dies on reload. That
// buys three things: a link that lands on the same round, a back button that
// steps through selections, and cross-page links that carry context instead of
// dumping you on a page's own default.
//
// Anything equal to the page's default is left out of the query string. A URL
// should say what the sharer actually changed, not restate every default.

export function foldParams(previous, updates, defaults = {}) {
  let params = new URLSearchParams(previous);
  for (const [key, value] of Object.entries(updates)) {
    params = nextParams(params, key, value, defaults[key] ?? '');
  }
  return params;
}

export function nextParams(previous, key, value, fallback = '') {
  const params = new URLSearchParams(previous);
  const resolved = value === null || value === undefined ? '' : String(value);
  if (resolved === '' || resolved === String(fallback)) params.delete(key);
  else params.set(key, resolved);
  return params;
}

// Build a link to another page carrying the selections it can use. Keys with
// an empty value are dropped so the target falls back to its own default
// rather than being handed a blank selection it has to recover from.
export function withParams(path, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

// useState, except the value lives in the query string. The setter takes a
// value or an updater, same as useState, and always replaces rather than
// pushes for non-navigational churn — see the call sites, which push nothing
// the user did not choose.
export function useUrlState(key, fallback = '') {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;

  const set = useCallback(
    (next) => {
      setParams(
        (previous) => {
          const current = previous.get(key) ?? fallback;
          const resolved = typeof next === 'function' ? next(current) : next;
          return nextParams(previous, key, resolved, fallback);
        },
        { replace: true },
      );
    },
    [key, fallback, setParams],
  );

  return [value, set];
}

// Two useUrlState setters fired in the same tick each navigate on their own,
// and the second can read the URL from before the first landed — so a page
// that picks a round *and* a session at once has to write them together or
// silently lose one. That is exactly what the auto-open effects do.
export function useUrlSelection(defaults = {}) {
  const [, setParams] = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);
  return useCallback(
    (updates) => {
      setParams((previous) => foldParams(previous, updates, JSON.parse(defaultsKey)), {
        replace: true,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultsKey, setParams],
  );
}
