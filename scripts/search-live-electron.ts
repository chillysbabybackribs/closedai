import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { createResearchRuntime } from '../src/main/research-runtime.js'
import { ToolRegistry } from '../src/main/tools/registry.js'

const profile = process.env.CLOSEDAI_SEARCH_CHECK_PROFILE
if (!profile) throw new Error('Run through scripts/search-live-check.mjs')
app.setPath('userData', profile)
const watchdog = setTimeout(() => { console.error('Live search fixture exceeded twenty seconds'); app.exit(1) }, 20_000)
// Do not await ready at module top level: Electron must finish loading its ESM entry first.
async function verify(profile: string): Promise<void> {
  await app.whenReady()
  let finishSource: (() => void) | undefined
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html')
    if (request.url === '/slow') {
      finishSource = () => response.end('<main>Background evidence</main>')
    } else response.end('<title>Live search verification</title><main>Browser evidence</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const window = new BrowserWindow({ show: false, width: 1000, height: 700 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 1000, height: 700, visible: true })
  const runtime = await createResearchRuntime({
    root: join(profile, 'research-runs'), browser: () => browser, workspace: () => profile,
    peers: () => ({ paneSnapshot: () => ({ threadId: 'thread', activeTurnId: 'turn' }) }) as never
  })
  try {
    const context = { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'call', signal: new AbortController().signal }
    const registry = new ToolRegistry([runtime.namespace])
    const result = await registry.call({ namespace: 'search', tool: 'run', arguments: {
      action: 'start', urls: [base, `${base}/slow`]
    } }, context)
    assert.equal(result.isError, undefined)
    const run = JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '')
    assert.equal(run.presentation.state, 'opened')
    const contents = browser.contentsOf(run.presentation.tabId)
    assert.ok(contents)
    for (let i = 0; i < 100 && (contents.getTitle() !== 'Live search verification' || !finishSource); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(contents.getTitle(), 'Live search verification')
    const pageText = await contents.executeJavaScript('document.querySelector("main").innerText')
    assert.equal(pageText, 'Browser evidence')
    assert.equal(browser.tabList().find((tab) => tab.active)?.id, run.presentation.tabId)
    assert.equal(runtime.service.read(run.runId, context).state, 'running')
    assert.ok(finishSource)
    finishSource()
    for (let i = 0; i < 100 && runtime.service.read(run.runId, context).state === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(runtime.service.read(run.runId, context).sources.filter((source) => source.state === 'ready').length, 2)
    console.log(JSON.stringify({ ok: true, tabId: run.presentation.tabId, pageText, backgroundWhileBrowserReady: 'running', readySources: 2 }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    runtime.service.dispose()
    browser.dispose()
    window.destroy()
    server.closeAllConnections()
    server.close()
    app.exit(process.exitCode ? 1 : 0)
  }
}

void verify(profile).catch((error: unknown) => { console.error(error); app.exit(1) })
