import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Flow publishes Resources/Public/ to _Resources/Static/Packages/<key>/.
// Build the SPA there and point asset URLs at that absolute base so the
// StudioController can serve the built index.html verbatim.
const base = '/_Resources/Static/Packages/Medienreaktor.NeosStudio/Studio/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../../Public/Studio',
    emptyOutDir: true,
    assetsDir: 'assets',
    // The SPA ships as a single chunk; raise the warning threshold above the
    // 500 kB default so an expected ~550 kB bundle doesn't flag every build.
    chunkSizeWarningLimit: 2000,
  },
})
