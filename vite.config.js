import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// Long-lived vendor chunks. Each library family gets its own named, content-
// hashed chunk so a deploy that only changes app code leaves them cached, and
// no shared chunk ends up named after whichever app module Rolldown saw first.
// Charts are only reachable through components/charts/LazyCharts.jsx, so the
// "charts" chunk is fetched on demand, never on first paint.
//
// Higher priority claims a module first. Groups also capture their
// dependencies, so "charts" must come last: otherwise it would pull React
// (a dependency of react-chartjs-2) into itself and be preloaded on every page.
const vendorChunks = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 50 },
  { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 40 },
  { name: 'ui', test: /node_modules[\\/](@radix-ui|@floating-ui|lucide-react|tailwind-merge|class-variance-authority|clsx)[\\/]/, priority: 30 },
  { name: 'data', test: /node_modules[\\/](@tanstack|date-fns)[\\/]/, priority: 20 },
  { name: 'charts', test: /node_modules[\\/](chart\.js|react-chartjs-2|@kurkle)[\\/]/, priority: 10 },
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  // Views and charts are lazy-loaded, so the dev server would otherwise find
  // their dependencies only when a view is first opened and then force a full
  // page reload to re-optimise. Scanning them up front avoids that.
  optimizeDeps: {
    entries: ['index.html', 'src/views/**/*.jsx', 'src/components/charts/*.jsx'],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: vendorChunks },
      },
    },
  },
})
