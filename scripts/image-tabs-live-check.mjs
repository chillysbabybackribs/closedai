// Real BrowserService + preload + React viewer, isolated from the user's running app/profile.
import { build } from 'esbuild'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = await mkdtemp(join(tmpdir(), 'closedai-image-tabs-'))
try {
  await build({ entryPoints: [resolve('scripts/image-tabs-live-electron.ts')], outfile: join(root, 'main.mjs'),
    bundle: true, platform: 'node', format: 'esm', external: ['electron'] })
  await build({ entryPoints: [resolve('src/preload/index.ts')], outfile: join(root, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  await build({ entryPoints: [resolve('scripts/image-tabs-renderer.tsx')], outfile: join(root, 'renderer.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic' })
  await build({ entryPoints: [resolve('src/renderer/styles/browser.css')], outfile: join(root, 'browser.css'),
    bundle: true })
  await writeFile(join(root, 'index.html'), `<!doctype html><html><head><link rel="stylesheet" href="browser.css">
    <style>:root{--background:#161617;--foreground:#eee;--muted:#343438;--muted-foreground:#aaa;--border:#38383e;--ring:#66aaff}
    *{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#202023;color:#eee}
    #root{height:100vh;display:grid;grid-template-columns:300px 1fr}aside{padding:24px}button{font:inherit}</style>
    </head><body><div id="root"></div><script src="renderer.js"></script></body></html>`)
  const env = { ...sanitizeGpuEnv().env, CLOSEDAI_IMAGE_CHECK_ROOT: root }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'NODE_OPTIONS']) delete env[key]
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(electron, ['--no-sandbox', join(root, 'main.mjs')], { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => done(code ?? 1))
  })
  if (process.exitCode) throw new Error('Image-tab Electron check failed; see diagnostics above')
  const result = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'))
  if (!result.passed) throw new Error('Image-tab verification did not complete')
  console.log(JSON.stringify(result))
} finally { await rm(root, { recursive: true, force: true }) }
