import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173
  }
})
