import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Frontend tests. Two projects share the app's Vite config (aliases, React):
//   unit        pure library code in src/lib, run in Node
//   components  React components and views, rendered in jsdom
// The chatbot backend has its own suite in api/ (cd api && npm test), and the
// browser end-to-end suite lives in e2e/ (npm run test:e2e).
export default mergeConfig(viteConfig, defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/frontend/**/*.test.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.{js,jsx}'],
          setupFiles: ['tests/setup/components.js'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      // shadcn primitives are vendored upstream code; main.jsx is bootstrap.
      exclude: ['src/components/ui/**', 'src/main.jsx'],
      // Regression floor only. The large view modules are exercised by the
      // Playwright suite in e2e/, which this number does not include; raise
      // the floor as component tests are added. Measured 2026-10-04.
      thresholds: {
        statements: 14,
        branches: 11,
        functions: 10,
        lines: 15,
      },
    },
  },
}))
