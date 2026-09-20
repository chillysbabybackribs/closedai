// Real React + preload + IPC + disk store, with deterministic public discovery fixtures.
// Run: xvfb-run -a node scripts/research-library-live-check.mjs
import { build } from 'esbuild'
import { build as buildWeb } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = await mkdtemp(join(tmpdir(), 'closedai-library-live-'))
try {
  await build({ entryPoints: [resolve('scripts/research-library-live-electron.ts')], outfile: join(root, 'main.mjs'),
    bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  await build({ entryPoints: [resolve('src/preload/index.ts')], outfile: join(root, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  await writeFile(join(root, 'fixture.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@fs/${resolve('scripts/research-library-renderer.tsx')}"></script></body></html>`)
  await buildWeb({ configFile: false, root, base: './', plugins: [react(), tailwindcss()],
    build: { outDir: join(root, 'web'), emptyOutDir: true, rollupOptions: { input: join(root, 'fixture.html') } } })
  const env = { ...sanitizeGpuEnv().env, CLOSEDAI_LIBRARY_CHECK_ROOT: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'NODE_OPTIONS']) delete env[key]
  const code = await new Promise((done, reject) => {
    const child = spawn(electron, ['--no-sandbox', join(root, 'main.mjs')], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (status) => done(status ?? 1))
  })
  if (code) throw new Error(`Research library live check failed; fixture retained at ${root}`)
  console.log(await readFile(join(root, 'result.json'), 'utf8'))
  // Opt in to retaining the screenshot for visual inspection; otherwise leave no fixture state.
  if (!process.env.CLOSEDAI_KEEP_LIBRARY_CHECK) await rm(root, { recursive: true, force: true })
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
