const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['__tests__/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['**/*.js'],
      exclude: [
        '__tests__/**',
        'coverage/**',
        'node_modules/**',
        'public/**',
        'vitest.config.js',
        // Process bootstrap only: listens on a port and starts timers. The
        // Express app it serves is built (and tested) in app.js.
        'server.js',
        // JSDoc-only contract file with no executable logic.
        'crm/CrmAdapter.js',
      ],
      // Regression floor, not a target: set just below the measured suite so
      // a change that removes tests or adds large untested modules fails CI.
      // Measured 2026-10-04: 82.1% statements, 75.8% branches, 84.1%
      // functions, 84.3% lines.
      thresholds: {
        statements: 80,
        branches: 73,
        functions: 82,
        lines: 82,
      },
    },
  },
});
