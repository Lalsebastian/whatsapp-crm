import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'api/node_modules',
    'api/coverage',
    'api/public',
    '.kilo/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Capitalised identifiers are components, icons and config objects — they
      // are routinely used only in JSX, which the core rule does not count as a
      // reference without eslint-plugin-react. `argsIgnorePattern` covers
      // destructured props (`icon: Icon = X`), which ESLint classifies as args
      // rather than vars.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['tests/**/*.{js,mjs}', 'e2e/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The chatbot backend is CommonJS on Node. Linting it catches undefined
    // identifiers and dead imports that its unit tests can miss.
    files: ['api/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]|^ignored',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        // Rest siblings are how flows drop keys from a context object.
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    // Backend tests mix ESM imports (vitest) with require() for the
    // require-cache patching pattern described in __tests__/ai.
    files: ['api/__tests__/**/*.js', 'api/vitest.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // shadcn primitives are vendored upstream code whose `*Variants` cva
    // exports must stay next to the component they style, so fast refresh is
    // allowed to treat them as component modules.
    files: ['src/components/ui/**/*.{js,jsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // lazyChart() returns a component (a Suspense wrapper around React.lazy).
    files: ['src/components/charts/LazyCharts.jsx'],
    rules: {
      'react-refresh/only-export-components': ['error', { allowConstantExport: true, extraHOCs: ['lazyChart'] }],
    },
  },
  {
    // The auth seam is intentionally one unit: the role table and the provider
    // that enforces it have to move together, and splitting them would let the
    // permissions drift from the roles. Named exports keep the rule active for
    // anything else added to the file.
    files: ['src/hooks/**/*.{js,jsx}'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: ['useCurrentUser', 'useTheme', 'ROLES', 'ROLE_META'],
        },
      ],
    },
  },
])
