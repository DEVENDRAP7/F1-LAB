import js from '@eslint/js';

// package.json has had a `lint` script and an eslint devDependency since
// the first commit, and it has never once run: ESLint 9 looks for a flat
// `eslint.config.js` and there was none, so `npm run lint` exited with a
// config error rather than a result.
//
// Deliberately core ESLint only. A React plugin would lint JSX properly,
// but adding one means adding dependencies, and docs/SPEC.md says to ask
// before changing the stack. Core espree parses JSX given the flag
// below, which is enough to catch the things that actually bite —
// unused bindings, undeclared globals, unreachable code.
//
// Globals are listed by hand for the same reason: the `globals` package
// is one more dependency to catch typos in a list this short.
const browser = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  matchMedia: 'readonly',
  devicePixelRatio: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextDecoder: 'readonly',
  performance: 'readonly',
  getComputedStyle: 'readonly',
  structuredClone: 'readonly',
  OfflineAudioContext: 'readonly',
};

const node = {
  process: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
  TextDecoder: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
};

const vitest = {
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', '.venv/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...browser, ...vitest },
    },
    rules: {
      // Caught real dead code during the Aero Rig work; worth keeping on.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // A component imported and then used only inside JSX looks unused to
    // core ESLint — marking that usage is exactly what eslint-plugin-react
    // exists for, and pulling it in is a stack change to ask about rather
    // than make quietly. So the rule is off here and stays on for the .js
    // modules, where it is accurate and where the dead code actually was.
    files: ['src/**/*.jsx'],
    rules: { 'no-unused-vars': 'off' },
  },
  {
    files: ['src/workers/**/*.js'],
    languageOptions: { globals: { ...browser, self: 'readonly', postMessage: 'readonly' } },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Browser globals too: the screenshot script is Node, but the
      // bodies of its page.evaluate callbacks are serialised and run
      // inside the page, where document and window are exactly right.
      globals: { ...node, ...browser },
    },
  },
];
