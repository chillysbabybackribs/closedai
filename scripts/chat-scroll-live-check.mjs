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
  await writeFile(join(root, 'profile', 'security-settings.json'), JSON.stringify({ importBrowserCookies: false }))
  const watchdog = setTimeout(() => { console.error('Chat scroll check timed out'); app.exit(1) }, 90_000)
  await import('../out/main/index.js')
  // Electron waits for the entry module's top-level await before emitting ready.
  void runChecks(BrowserWindow).then(() => {
    clearTimeout(watchdog)
    app.quit()
  }, (error) => {
    console.error(error)
    clearTimeout(watchdog)
    app.exit(1)
  })
}

async function runChecks(BrowserWindow) {
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
      const a = Array.from(v.querySelectorAll('[data-scroll-anchor]')).at(-1);
      rows.push({ top:v.scrollTop, height:v.scrollHeight,
        anchor:a.getBoundingClientRect().top-v.getBoundingClientRect().top,
        spacer:v.querySelector('[data-message-scroller-spacer]').style.height });
      if(rows.length < ${count}) requestAnimationFrame(frame); else resolve(rows);
    }; requestAnimationFrame(frame);
  })`)
  const reports = []
  for (const zoom of [50, 80, 100, 110, 150, 200, 250]) {
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
      drift: Math.max(...tops) - Math.min(...tops), anchor: tops.at(-1) })
  }
  console.log('CHAT_SCROLL_RESULT', JSON.stringify(reports))
  assert.ok(reports.every((report) => report.drift <= 1 && report.streamingDrift <= 1),
    'An anchored transcript must not oscillate during streaming or while idle')
  assert.ok(reports.every((report) => Math.abs(report.anchor - 12 * report.zoom / 100) <= 1),
    'Prompt peek must use transcript coordinates at every zoom')

  const delta = () => send({ type: 'itemDelta', itemId: 'reply-250', field: 'text',
    delta: '\n\n' + 'A longer response to exercise scrolling and reading above the bottom. '.repeat(30) })
  delta()
  await pause(1000)
  const metrics = () => evaluate(`(() => {
    const v = document.querySelector('.chat-scroll');
    return {top:v.scrollTop, remaining:v.scrollHeight-v.clientHeight-v.scrollTop};
  })()`)
  const latest = async () => {
    await evaluate(`document.querySelector('[data-slot="message-scroller-button"][data-direction="end"]').click()`)
    await pause(700)
  }
  await latest()
  delta()
  await pause(1000)
  assert.ok((await metrics()).remaining <= 1, 'Following must track streamed growth at the bottom')
  const point = await evaluate(`(() => {
    const r = document.querySelector('.chat-scroll').getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  })()`)
  window.webContents.focus()
  window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
  // Electron's native wheel delta is positive upwards (DOM WheelEvent has the opposite sign).
  window.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: 600, deltaX: 0 })
  await pause(400)
  const reading = await metrics()
  assert.ok(reading.remaining > 24, 'Native wheel input must leave bottom following')
  delta()
  await pause(1000)
  assert.equal((await metrics()).top, reading.top, 'Streaming must preserve the manually chosen reading position')
  await latest()
  assert.ok((await metrics()).remaining <= 1, 'Jump to latest must resume following')

  send({ type: 'turn', turnId: 'next-turn' })
  send({ type: 'item', item: { type: 'user', id: 'next-prompt', turnId: 'next-turn', text: 'A second prompt stays anchored too.' } })
  await pause(200)
  const next = await sample()
  assert.ok(next.every((frame) => Math.abs(frame.anchor - 30) <= 1), 'A subsequent prompt must re-anchor')
  window.setSize(1280, 800)
  await pause(200)
  const resized = await sample()
  assert.ok(resized.every((frame) => Math.abs(frame.anchor - 30) <= 1), 'Resizing must retain the prompt anchor')
  // Revisit an attached pane after its workspace snapshot was reduced to the latest turn.
  const historyItems = Array.from({ length: 5 }, (_, index) => [
    { type: 'user', id: `history-user-${index}`, turnId: `history-turn-${index}`, text: `History prompt ${index}` },
    { type: 'assistant', id: `history-answer-${index}`, turnId: `history-turn-${index}`,
      text: `History answer ${index}`, phase: 'final_answer', streaming: false }
  ]).flat()
  const historyPane = { ...workspace.selected, threadId: 'history-check', activeTurnId: null,
    items: historyItems, history: { hasEarlier: false } }
  send({ type: 'replace', snapshot: historyPane })
  await pause(250)
  const answerCount = () => evaluate(`document.querySelectorAll('.prompt-message-assistant').length`)
  assert.equal(await answerCount(), 5, 'Every loaded answer must render, beyond the old three-turn ceiling')
  await evaluate(`(() => { const v = document.querySelector('.chat-scroll'); v.scrollTop = v.scrollHeight; v.dispatchEvent(new Event('scroll')); })()`)
  await pause(200)
  assert.equal(await answerCount(), 5, 'Reaching the bottom must not fold history')
  const otherId = 'history-other-pane'
  const otherPane = { ...historyPane, threadId: 'other-thread', items: [] }
  const chats = [...workspace.chats, { ...workspace.chats[0], paneId: otherId, attached: true, title: 'Other chat' }]
  window.webContents.send('chat:event', { type: 'workspace', snapshot: { ...workspace,
    chats, selectedPaneId: otherId, selected: otherPane, panes: { [otherId]: otherPane } } })
  await pause(250)
  const tail = { ...historyPane, items: historyItems.slice(-2), history: { hasEarlier: true } }
  window.webContents.send('chat:event', { type: 'workspace', snapshot: { ...workspace,
    chats, selectedPaneId: paneId, selected: tail, panes: { [paneId]: tail } } })
  await pause(250)
  assert.equal(await answerCount(), 5, 'Returning to a tab must retain its loaded answers')
  console.log('CHAT_HISTORY_CHECKS passed: five turns, bottom scrolling, tab return')
  await writeFile('/tmp/closedai-scroll-verification.png', (await window.webContents.capturePage()).toPNG())
  console.log('CHAT_SCROLL_CHECKS passed: streaming, idle, zoom, bottom following, wheel escape, next prompt, resize')
}
