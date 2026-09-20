import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  // `build.watch` makes `electron-vite dev` rebuild main/preload on change and restart Electron.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { watch: {}, rollupOptions: { input: {
      index: resolve('src/main/index.ts'),
      'artifact-worker': resolve('src/main/investigations/artifact-worker.ts'),
      'pdf-worker': resolve('src/main/tools/search/research/pdf/pdf-worker.ts'),
      'pdf-page-worker': resolve('src/main/tools/search/research/pdf/page-worker.ts')
    } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { watch: {}, rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve('src') } }
  }
})
