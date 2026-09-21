// Exercise real Chromium popup/opener behavior without touching the running app or its login.
// Linux: xvfb-run -a node scripts/popup-tabs-live-check.mjs
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = await mkdtemp(join(tmpdir(), 'closedai-popup-tabs-'))
try {
  await build({ entryPoints: [resolve('scripts/popup-tabs-live-electron.ts')], outfile: join(root, 'main.mjs'),
    bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  const env = { ...sanitizeGpuEnv().env, CLOSEDAI_POPUP_CHECK_ROOT: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'NODE_OPTIONS']) delete env[key]
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(electron, ['--no-sandbox', join(root, 'main.mjs')], { env, stdio: 'inherit' })
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 55_000)
    child.once('error', (error) => { clearTimeout(watchdog); reject(error) })
    child.once('exit', (code) => { clearTimeout(watchdog); done(code ?? 1) })
  })
} finally { await rm(root, { recursive: true, force: true }) }
