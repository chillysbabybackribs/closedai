// Run after npm run build. Uses the real main, preload, renderer and chat event contract;
// only provider events are supplied by the check, in a disposable Electron profile.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { sanitizeGpuEnv, sandboxEnv, sandboxBlockedReason } from './launch-electron-vite.mjs'
import { readFileSync, statSync } from 'node:fs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!process.versions.electron) {
  const root = await mkdtemp(join(tmpdir(), 'closedai-scroll-'))
  try {
    const { default: electron } = await import('electron')
    const env = sandboxEnv(sanitizeGpuEnv().env,
      sandboxBlockedReason(repo, { readFileSync, statSync }))
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_RENDERER_URL']) delete env[key]
    env.CLOSEDAI_SCROLL_CHECK_ROOT = root
    // No model requests or access to provider accounts are needed for renderer verification.
    env.CLOSEDAI_CODEX_PATH = join(root, 'no-provider')
    const child = spawn(electron, [fileURLToPath(import.meta.url)], { cwd: repo, env, stdio: 'inherit' })
    process.exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code) => resolve(code ?? 1))
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow } = await import('electron')
  const root = process.env.CLOSEDAI_SCROLL_CHECK_ROOT
  assert.ok(root, 'Launch with node scripts/chat-scroll-live-check.mjs')
  await mkdir(join(root, 'profile'), { recursive: true })
  app.setPath('userData', join(root, 'profile'))
  await writeFile(join(root, 'profile', 'app-settings.json'), JSON.stringify({ browserCookiesImported: true }))
  const watchdog = setTimeout(() => { console.error('Chat scroll check timed out'); app.exit(1) }, 60_000)
  await import('../out/main/index.js')
  // Electron waits for the entry module's top-level await before emitting ready.
  void (async () => { try {
    let window
    for (let i = 0; i < 200; i++) {
      window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/renderer/'))
      if (window && !window.webContents.isLoading()) break
      await pause(50)
    }
    assert.ok(window)
    const evaluate = (code) => window.webContents.executeJavaScript(code)
    for (let i = 0; i < 100; i++) {
      if (await evaluate('Boolean(document.querySelector(".chat-scroll"))')) break
      await pause(50)
    }
    await pause(500)
    const workspace = await evaluate('window.closedai.chat.snapshot()')
    const paneId = workspace.selectedPaneId
    const send = (event) => window.webContents.send('chat:event', { type: 'pane', paneId, event })
    const sample = (count = 30) => evaluate(`new Promise(resolve => {
      const rows = [];
      const frame = () => {
        const v = document.querySelector('.chat-scroll');
        const a = v.querySelector('[data-scroll-anchor]');
        rows.push({ top:v.scrollTop, height:v.scrollHeight,
          anchor:a.getBoundingClientRect().top-v.getBoundingClientRect().top,
          spacer:v.querySelector('[data-message-scroller-spacer]').style.height });
        if(rows.length < ${count}) requestAnimationFrame(frame); else resolve(rows);
      }; requestAnimationFrame(frame);
    })`)
    const reports = []
    for (const zoom of [100, 80, 110, 150, 200, 250]) {
      await evaluate(`(() => {
        const surface = document.querySelector('.chat-zoom-surface');
        surface.style.setProperty('--chat-zoom', '${zoom / 100}');
        surface.style.setProperty('--chat-zoom-inverse', '${100 / zoom}');
      })()`)
      send({ type: 'replace', snapshot: { ...workspace.selected, connection: { state: 'ready', message: '' },
        threadId: `scroll-${zoom}`, activeTurnId: `turn-${zoom}`, items: [], history: { hasEarlier: true } } })
      await pause(80)
      send({ type: 'item', item: { type: 'user', id: `prompt-${zoom}`, turnId: `turn-${zoom}`, text: 'Keep this prompt steady while the response streams.' } })
      await pause(150)
      const streamingFrames = sample(100)
      send({ type: 'item', item: { type: 'assistant', id: `reply-${zoom}`, turnId: `turn-${zoom}`, phase: 'commentary', streaming: true, text: 'The response is streaming. ' } })
      for (let i = 0; i < 15; i++) {
        send({ type: 'itemDelta', itemId: `reply-${zoom}`, field: 'text', delta: 'More words arrive and wrap onto another line. ' })
        await pause(30)
      }
      await pause(800)
      const streamed = await streamingFrames
      const frames = await sample()
      const tops = frames.map((frame) => frame.anchor)
      const positions = streamed.map((frame) => frame.anchor)
      reports.push({ zoom, streamingDrift: Math.max(...positions) - Math.min(...positions),
        drift: Math.max(...tops) - Math.min(...tops), frames: streamed.slice(0, 8) })
    }
    console.log('CHAT_SCROLL_RESULT', JSON.stringify(reports))
    assert.ok(reports.every((report) => report.drift <= 1 && report.streamingDrift <= 1),
      'An anchored transcript must not oscillate during streaming or while idle')
    clearTimeout(watchdog)
    app.quit()
  } catch (error) {
    console.error(error)
    clearTimeout(watchdog)
    app.exit(1)
  } })()
}
