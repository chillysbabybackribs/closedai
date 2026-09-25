// Targeted Electron regression: a page recorded to MP4 shows CSS animations, timers, and
// requestAnimationFrame work at exact virtual times. Temporary bundle/profile; no rebuild or
// restart of the user's app. Needs ffmpeg on PATH (or CLOSEDAI_FFMPEG).
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = await mkdtemp(join(tmpdir(), 'closedai-video-render-live-'))
try {
  const entry = join(root, 'check.mjs')
  await build({
    entryPoints: [resolve('scripts/video-render-live-electron.ts')], outfile: entry,
    bundle: true, platform: 'node', format: 'esm', external: ['electron']
  })
  const env = { ...sanitizeGpuEnv().env, CLOSEDAI_VIDEO_CHECK_ROOT: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'NODE_OPTIONS']) delete env[key]
  const code = await new Promise((done, reject) => {
    const child = spawn(electron, ['--no-sandbox', '--force-color-profile=srgb', entry], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => done(code ?? 1))
  })
  process.exitCode = code
} finally {
  await rm(root, { recursive: true, force: true })
}
