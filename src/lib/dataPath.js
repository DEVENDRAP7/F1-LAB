// Every fetch of a public/data/* artifact must go through this helper.
// A leading '/' resolves against the domain root, which 404s once the
// site is served from a Pages project path (BASE_URL = '/F1-LAB/').
export function dataPath(relativePath) {
  const base = import.meta.env.BASE_URL;
  return `${base}data/${relativePath}`.replace(/\/{2,}/g, '/');
}
