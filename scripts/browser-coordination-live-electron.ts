import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { app, BrowserWindow, nativeImage } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { BrowserPageAccess } from '../src/main/browser-page-access.js'
import { BrowserCdpAccess } from '../src/main/cdp/browser-cdp-access.js'
import { UiCaptureAccess } from '../src/main/ui-capture-access.js'
import { AppCommandAccess } from '../src/main/app-commands.js'
import { BrowserCoordination } from '../src/main/tools/browser/coordination.js'
import { browserTools, cdpTools, captureTools, appTools, ToolRegistry } from '../src/main/tools/index.js'
import { ScreenshotStore } from '../src/main/tools/capture/screenshot-store.js'
import type { JsonObject, ToolResult } from '../src/main/tools/tool.js'

const profile = process.env.CLOSEDAI_BROWSER_COORDINATION_PROFILE
if (!profile) throw new Error('Run through browser-coordination-live-check.mjs')
app.setPath('userData', profile)
const watchdog = setTimeout(() => { console.error('Browser coordination fixture timed out'); app.exit(1) }, 40_000)
const text = (result: ToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
const ok = (result: ToolResult) => { assert.ok(!result.isError, text(result)); return result }
function assertColor(dataUrl: string, red: boolean) {
  const pixels = nativeImage.createFromDataURL(dataUrl)
  const { width, height } = pixels.getSize()
  assert.ok(width > 100 && height > 100, `usable screenshot viewport: ${width}x${height}`)
  const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4
  assert.ok(pixels.toBitmap()[offset + (red ? 2 : 0)] > 220, 'screenshot has the expected page color')
}

async function verify() {
  await app.whenReady()
  const server = createServer((request, response) => {
    const red = request.url?.includes('/a')
    response.setHeader('content-type', 'text/html')
    response.end(`<!doctype html><title>${red ? 'Page A' : 'Page B'}</title>
      <style>html,body{margin:0;height:100%;background:${red ? 'red' : 'blue'}}</style>
      <body><button onclick="this.textContent='clicked'">${red ? 'Alpha' : 'Beta'}</button>
      <script>window.keys=0;document.addEventListener('keydown',()=>window.keys++)</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const window = new BrowserWindow({ show: true, width: 800, height: 600 })
  await new Promise(resolve => setTimeout(resolve, 300))
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: `${base}/user` })
  browser.setBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
  const foreground = browser.tabList().find(tab => tab.active)!.id
  const coordination = new BrowserCoordination({ tabs: () => browser.tabList(),
    create: () => browser.openNewTab('about:blank', false), paneExists: pane => ['a', 'b'].includes(pane) })
  browser.on('popup', (opener, child) => coordination.inherit(opener, child))
  const page = new BrowserPageAccess(() => browser)
  await page.waitFor(foreground, { until: 'load', timeoutMs: 5000 })
  await browser.contentsOf(foreground)!.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const cdp = new BrowserCdpAccess(() => browser)
  const capture = new UiCaptureAccess(() => window, () => browser)
  const commands = new AppCommandAccess({ browser: () => browser, chat: () => null,
    downloads: () => null, window: () => window, browserCoordination: coordination })
  const registry = new ToolRegistry([browserTools(() => page), cdpTools(() => cdp),
    captureTools(() => capture, new ScreenshotStore()), appTools(() => commands, () => null)])
  registry.browserCoordination = coordination
  let callId = 0
  const call = (pane: string, namespace: string, tool: string, args: JsonObject) => registry.call(
    { namespace, tool, arguments: args },
    { paneId: pane, threadId: pane, turnId: pane, callId: `fixture-${++callId}`, source: 'exec' })
  const active = () => browser.tabList().find(tab => tab.active)!.id
  try {
    const navigations = await Promise.all(['a', 'b'].map(pane => call(pane, 'embedded_browser', 'page',
      { action: 'navigate', url: `${base}/${pane}`, wait_until: 'load', timeout_ms: 5000 })))
    navigations.forEach(ok)
    const a = coordination.snapshot('a').defaultTabId!
    const b = coordination.snapshot('b').defaultTabId!
    assert.notEqual(a, b)
    assert.equal(active(), foreground, 'background navigation must preserve user selection')
    const reads = await Promise.all(['a', 'b'].map(pane => call(pane, 'embedded_browser', 'page', { action: 'read_page' })))
    assert.match(text(ok(reads[0])), /Alpha/)
    assert.match(text(ok(reads[1])), /Beta/)
    const captures = await Promise.all(['a', 'b'].map(pane => call(pane, 'closedai_ui', 'capture', { action: 'browser_page' })))
    for (const [index, result] of captures.entries()) {
      ok(result)
      const image = result.content.find(item => item.type === 'image')
      assert.ok(image && image.type === 'image')
      assertColor(image.dataUrl, index === 0)
    }
    assert.equal(active(), foreground)
    await browser.setBounds({ x: 0, y: 0, width: 800, height: 600, visible: false })
    ok(await call('a', 'embedded_browser', 'page', { action: 'navigate', new_tab: true, url: `${base}/a-hidden` }))
    const collapsed = ok(await call('a', 'closedai_ui', 'capture', { action: 'browser_page' }))
    const hiddenImage = collapsed.content.find(item => item.type === 'image')
    assert.ok(hiddenImage && hiddenImage.type === 'image')
    assertColor(hiddenImage.dataUrl, true)
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'temporary capture window is released')
    const restoredId = coordination.snapshot('a').defaultTabId!
    assert.equal(browser.contentsOf(restoredId)!.getBackgroundThrottling(), true, 'capture restores throttling')
    // Exercise cold hidden surfaces repeatedly; DOM readiness can precede the first Viz frame.
    for (let index = 0; index < 3; index++) {
      const cold = browser.openNewTab(`${base}/a-cold-${index}`, false)
      const image = await capture.captureBrowserPage(cold, { until: 'load', timeoutMs: 5000 })
      assert.ok(image?.image, JSON.stringify(image))
      assertColor(image.image.dataUrl, true)
      assert.equal(BrowserWindow.getAllWindows().length, 1)
      browser.closeTab(cold)
    }
    await browser.setBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    browser.selectTab(restoredId)
    const restored = await capture.captureBrowserPage(restoredId, { until: 'load', timeoutMs: 5000 })
    assert.ok(restored?.image)
    assertColor(restored.image.dataUrl, true)
    browser.selectTab(foreground)
    ok(await call('a', 'embedded_browser', 'page', { action: 'read_page', tab_id: a }))
    const blocked = await call('b', 'embedded_browser', 'page', { action: 'navigate', tab_id: a, url: `${base}/wrong` })
    assert.equal(blocked.isError, true)
    assert.equal(browser.contentsOf(a)!.getURL(), `${base}/a`)
    const before = browser.tabList().length
    assert.equal((await call('a', 'closedai_app', 'command', { action: 'browser_tab', op: 'close_others', tab_id: a })).isError, true)
    assert.equal(browser.tabList().length, before)
    const input = { action: 'command', method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a' },
      fallback_reason: 'Fixture verifies native input routing; text reads before and after verify the target.' }
    const [first, conflict] = await Promise.all(['a', 'b'].map(pane => call(pane, 'browser_cdp', 'protocol', input)))
    ok(first)
    assert.equal(conflict.isError, true)
    assert.match(text(conflict), /busy/)
    ok(await call('b', 'browser_cdp', 'protocol', input))
    assert.equal(await browser.contentsOf(a)!.executeJavaScript('window.keys'), 1)
    assert.equal(await browser.contentsOf(b)!.executeJavaScript('window.keys'), 1)
    assert.equal(active(), b)
    // A background opener cannot steal focus; its child is protected by the same chat.
    const beforePopup = new Set(browser.tabList().map(tab => tab.id))
    await browser.contentsOf(a)!.executeJavaScript(`void window.open('${base}/a-popup')`, true)
    const deadline = Date.now() + 3000
    while (browser.tabList().length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    const popup = browser.tabList().find(tab => !beforePopup.has(tab.id))
    assert.ok(popup)
    assert.equal(active(), b)
    assert.equal(coordination.canUse(popup.id, 'b'), false)
    // App new also stays in the background, and release allows an explicit handoff.
    ok(await call('a', 'closedai_app', 'command', { action: 'browser_tab', op: 'new', url: `${base}/new` }))
    assert.equal(active(), b)
    ok(await call('a', 'closedai_app', 'command', { action: 'browser_tab', op: 'release', tab_id: a }))
    ok(await call('b', 'embedded_browser', 'page', { action: 'read_page', tab_id: a }))
    browser.closeTab(a)
    assert.equal((await call('b', 'embedded_browser', 'page', { action: 'read_page' })).isError, true)
    console.log(JSON.stringify({ ok: true, checks: ['parallel navigation', 'parallel text', 'background capture pixels',
      'collapsed browser capture and restoration', 'ownership conflict', 'bulk close preflight', 'foreground input exclusion',
      'popup ownership', 'release', 'closed target'] }))
  } finally {
    clearTimeout(watchdog)
    cdp.dispose()
    browser.dispose()
    window.destroy()
    server.closeAllConnections()
    server.close()
  }
}

void verify().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
