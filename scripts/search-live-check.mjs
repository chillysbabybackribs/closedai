// Targeted Electron regression: temporary bundle/profile, no rebuild or restart of the user's app.
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = await mkdtemp(join(tmpdir(), 'closedai-search-live-'))
try {
  const entry = join(root, 'check.mjs')
  await build({
    entryPoints: [resolve('scripts/search-live-electron.ts')], outfile: entry,
    bundle: true, platform: 'node', format: 'esm', external: ['electron']
  })
  const env = { ...sanitizeGpuEnv().env, CLOSEDAI_SEARCH_CHECK_PROFILE: join(root, 'profile') }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'NODE_OPTIONS']) delete env[key]
  const code = await new Promise((done, reject) => {
    const child = spawn(electron, ['--no-sandbox', entry], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => done(code ?? 1))
  })
  process.exitCode = code
} finally {
  await rm(root, { recursive: true, force: true })
}
