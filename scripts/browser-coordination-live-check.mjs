// Isolated Electron check: real browser tabs, registry routing, pixels, and foreground input.
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = await mkdtemp(join(tmpdir(), 'closedai-browser-coordination-'))
try {
  const entry = join(root, 'check.mjs')
  await build({ entryPoints: [resolve('scripts/browser-coordination-live-electron.ts')], outfile: entry,
    bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  const env = { ...sanitizeGpuEnv().env, CLOSEDAI_BROWSER_COORDINATION_PROFILE: join(root, 'profile') }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'NODE_OPTIONS']) delete env[key]
  process.exitCode = await new Promise((resolveCode, reject) => {
    const child = spawn(electron, ['--no-sandbox', entry], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => resolveCode(code ?? 1))
  })
} finally {
  await rm(root, { recursive: true, force: true })
}
