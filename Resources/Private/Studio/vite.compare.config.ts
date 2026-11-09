import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Third build: the compare script the PreviewController injects into the
// side-by-side review frames (?compare=1). Same shape as the guest build - a
// single self-contained IIFE with a stable filename the PHP side references -
// and it runs after the SPA build, which owns (and empties) the output
// directory.
export default defineConfig({
  build: {
    outDir: '../../Public/Studio',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/compare/main.ts', import.meta.url)),
      name: 'NeosStudioCompare',
      formats: ['iife'],
      fileName: () => 'compare.js',
    },
  },
})
