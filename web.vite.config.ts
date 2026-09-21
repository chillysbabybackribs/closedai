import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  // Only the web development server substitutes the fixture entry. Electron uses main.tsx.
  plugins: [react(), tailwindcss(), {
    name: 'closedai-ui-preview',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace('./main.tsx', './preview/entry.tsx')
    }
  }],
  resolve: { alias: { '@': resolve('src') } },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
})
