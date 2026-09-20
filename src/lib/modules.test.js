import { describe, expect, it } from 'vitest';
import { GROUPS, LEGACY_PATHS, MODULES, groupOf, viewsOf } from './modules.js';
import { DESTINATIONS, relatedLinks } from './relatedLinks.js';
import { resolveView } from '../components/ViewTabs.jsx';

const paths = new Set(MODULES.map((m) => m.to));

describe('the site map', () => {
  it('gives every module a path, a name and a line', () => {
    for (const module of MODULES) {
      expect(module.to.startsWith('/')).toBe(true);
      expect(module.name).toBeTruthy();
      expect(module.line).toBeTruthy();
    }
  });

  it('lists no path twice', () => {
    expect(paths.size).toBe(MODULES.length);
  });

  it('finds the group a path belongs to, and nothing for one that does not', () => {
    expect(groupOf('/aero')).toBe('car');
    expect(groupOf('/aero-rig')).toBe(null);
    expect(GROUPS.map((g) => g.id)).toContain(groupOf(MODULES[0].to));
  });
});

describe('merged pages', () => {
  it('gives a merged page at least two views, each with a distinct key', () => {
    for (const module of MODULES) {
      if (!module.views) continue;
      expect(module.views.length).toBeGreaterThan(1);
      const keys = module.views.map((v) => v.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const view of module.views) expect(view.name && view.line).toBeTruthy();
    }
  });

  it('has views for exactly the pages something redirects into', () => {
    for (const { to } of Object.values(LEGACY_PATHS)) {
      expect(viewsOf(to).length).toBeGreaterThan(1);
    }
  });

  it('returns nothing for a page that is not merged', () => {
    expect(viewsOf('/ledger')).toEqual([]);
    expect(viewsOf('/nope')).toEqual([]);
  });
});

// The whole point of keeping the old paths is that a link written down
// before the merge still works. That only holds while every one of them
// names a page that exists and a view that page actually has.
describe('the paths that used to be pages', () => {
  it('is not itself a live module path', () => {
    for (const from of Object.keys(LEGACY_PATHS)) expect(paths.has(from)).toBe(false);
  });

  it('lands on a live page', () => {
    for (const { to } of Object.values(LEGACY_PATHS)) expect(paths.has(to)).toBe(true);
  });

  it('names a view that page has, or none at all', () => {
    for (const [from, { to, view }] of Object.entries(LEGACY_PATHS)) {
      if (view === undefined) continue;
      expect(viewsOf(to).map((v) => v.key), from).toContain(view);
    }
  });

  it('never redirects to a view that is already the default', () => {
    for (const [from, { to, view }] of Object.entries(LEGACY_PATHS)) {
      expect(view, from).not.toBe(viewsOf(to)[0].key);
    }
  });
});

describe('related links after the merge', () => {
  it('sends every destination to a live page', () => {
    for (const [key, destination] of Object.entries(DESTINATIONS)) {
      expect(paths.has(destination.to ?? key), key).toBe(true);
    }
  });

  it('names a view the destination page has', () => {
    for (const [key, destination] of Object.entries(DESTINATIONS)) {
      if (!destination.view) continue;
      expect(viewsOf(destination.to).map((v) => v.key), key).toContain(destination.view);
    }
  });

  it('carries the view into the link', () => {
    const [style] = relatedLinks(['/style'], { round: 4, session: 'R' });
    expect(style.to).toBe('/lines');
    expect(style.params).toEqual({ round: 4, session: 'R', view: 'style' });
  });

  it('leaves the view out when the destination is a page default', () => {
    const [lines] = relatedLinks(['/lines'], { round: 4, session: 'R' });
    expect(lines.params).toEqual({ round: 4, session: 'R' });
  });
});

describe('resolveView', () => {
  const views = [{ key: 'lines' }, { key: 'style' }];

  it('takes the view that was asked for', () => {
    expect(resolveView(views, 'style')).toBe('style');
  });

  it('falls back to the first view rather than showing nothing', () => {
    expect(resolveView(views, 'gone')).toBe('lines');
    expect(resolveView(views, '')).toBe('lines');
    expect(resolveView(views, undefined)).toBe('lines');
  });
});
