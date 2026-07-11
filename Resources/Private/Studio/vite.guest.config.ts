import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Second build: the guest script the PreviewController injects into edit-mode
// preview responses. A single self-contained IIFE with a stable filename (no
// hash) so the PHP side can reference it. Runs after the SPA build, which
// owns (and empties) the output directory.
export default defineConfig({
  build: {
    outDir: '../../Public/Studio',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/guest/main.ts', import.meta.url)),
      name: 'NeosStudioGuest',
      formats: ['iife'],
      fileName: () => 'guest.js',
    },
  },
})
