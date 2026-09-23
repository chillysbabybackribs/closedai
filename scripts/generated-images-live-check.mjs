// Run after npm run build. Real Electron main/preload/renderer in a disposable profile;
// provider items pass through the production transcript adapter without a model request.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { sanitizeGpuEnv, sandboxEnv, sandboxBlockedReason } from './launch-electron-vite.mjs'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

if (!process.versions.electron) {
  const root = await mkdtemp(join(tmpdir(), 'closedai-generated-images-'))
  try {
    const { build } = await import('esbuild')
    await build({ entryPoints: [join(repo, 'src/main/chat-transcript.ts')],
      outfile: join(root, 'transcript.mjs'), bundle: true, platform: 'node', format: 'esm' })
    const { default: electron } = await import('electron')
    const env = sandboxEnv(sanitizeGpuEnv().env, sandboxBlockedReason(repo, { readFileSync, statSync }))
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_RENDERER_URL']) delete env[key]
    env.CLOSEDAI_GENERATED_IMAGE_CHECK_ROOT = root
    env.CLOSEDAI_CODEX_PATH = join(root, 'no-provider')
    const child = spawn(electron, [fileURLToPath(import.meta.url)], { cwd: repo, env, stdio: 'inherit' })
    process.exitCode = await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => done(code ?? 1))
    })
  } finally { await rm(root, { recursive: true, force: true }) }
} else {
  const { app, BrowserWindow } = await import('electron')
  const root = process.env.CLOSEDAI_GENERATED_IMAGE_CHECK_ROOT
  assert.ok(root)
  await mkdir(join(root, 'profile'), { recursive: true })
  app.setPath('userData', join(root, 'profile'))
  await writeFile(join(root, 'profile/app-settings.json'), JSON.stringify({ browserCookiesImported: true }))
  await writeFile(join(root, 'profile/security-settings.json'), JSON.stringify({ importBrowserCookies: false }))
  const watchdog = setTimeout(() => { console.error('Generated-image check timed out'); app.exit(1) }, 60_000)
  await import('../out/main/index.js')
  void check(BrowserWindow, root).then(() => {
    clearTimeout(watchdog)
    app.quit()
  }, (error) => {
    console.error(error)
    clearTimeout(watchdog)
    app.exit(1)
  })
}

async function check(BrowserWindow, root) {
  let window
  for (let attempt = 0; attempt < 200; attempt++) {
    window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/renderer/'))
    if (window && !window.webContents.isLoading()) break
    await pause(50)
  }
  assert.ok(window)
  const evaluate = (code) => window.webContents.executeJavaScript(code)
  async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return
      await pause(50)
    }
    assert.fail(`Timed out: ${expression}`)
  }
  await until('Boolean(document.querySelector(".chat-scroll"))')
  await pause(500)
  const workspace = await evaluate('window.closedai.chat.snapshot()')
  const paneId = workspace.selectedPaneId
  const send = (event) => window.webContents.send('chat:event', { type: 'pane', paneId, event })
  const { ChatTranscript } = await import(join(root, 'transcript.mjs'))
  const bytes = await readFile(process.env.CLOSEDAI_GENERATED_IMAGE_FIXTURE || join(repo, 'resources/icon.png'))
  const path = join(root, 'generated #1.png')
  await writeFile(path, bytes)
  const raw = { type: 'imageGeneration', id: 'image-1', status: 'completed', result: bytes.toString('base64'), savedPath: path }
  const live = new ChatTranscript(repo, () => 'turn-1', send)
  const user = { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: 'Create a composer mockup.' }] }
  send({ type: 'replace', snapshot: { ...workspace.selected, threadId: 'image-check', activeTurnId: 'turn-1',
    connection: { state: 'ready', message: '' }, items: [], history: { hasEarlier: false } } })
  live.consume(user, 'turn-1', true)
  live.consume({ ...raw, result: '', status: 'inProgress' }, 'turn-1', false)
  live.consume(raw, 'turn-1', true)
  live.consume(raw, 'turn-1', true)
  await until('document.querySelector(".prompt-generated-image img")?.naturalWidth > 0')
  assert.equal(await evaluate('document.querySelectorAll(".prompt-generated-image").length'), 1)
  await evaluate('document.querySelector("[data-ui=\"chat.generated-image\"]").click()')
  await until('document.querySelector(".image-viewer:not([hidden]) img")?.naturalWidth > 0')
  assert.equal(await evaluate('window.closedai.browser.snapshot().then(s => s.tabs.some(t => t.image?.path?.endsWith("generated #1.png")))'), true)

  // Replay through the same adapter must retain all three images, once each, in order.
  const replay = new ChatTranscript(repo, () => null, () => {})
  replay.replaceFromThread({ turns: [{ id: 'turn-1', items: [user, raw,
    { ...raw, id: 'image-2', savedPath: null }, { ...raw, id: 'image-3' }] }] })
  send({ type: 'replace', snapshot: { ...workspace.selected, threadId: 'image-check', activeTurnId: null,
    items: replay.snapshot(), history: { hasEarlier: false } } })
  await until('document.querySelectorAll(".prompt-generated-image img").length === 3 && [...document.querySelectorAll(".prompt-generated-image img")].every(i => i.naturalWidth > 0)')
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".prompt-generated-image")].map(b => b.dataset.uiKey)'), ['image-1', 'image-2', 'image-3'])
  await evaluate('document.querySelector("[data-ui=\"chat.generated-image\"][data-ui-key=\"image-2\"]").click()')
  await until('document.querySelector(".image-viewer:not([hidden]) img")?.naturalWidth > 0')
  if (process.env.CLOSEDAI_GENERATED_IMAGE_CAPTURE) {
    await writeFile(process.env.CLOSEDAI_GENERATED_IMAGE_CAPTURE, (await window.webContents.capturePage()).toPNG())
  }
  console.log('GENERATED_IMAGES_RESULT', JSON.stringify({ live: true, replayImages: 3, duplicateFree: true, filePreview: true, dataPreview: true }))
}
