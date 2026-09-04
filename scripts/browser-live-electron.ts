import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { BrowserPageAccess } from '../src/main/browser-page-access.js'
import { BrowserNetworkAccess } from '../src/main/browser-network-access.js'
import { ToolRegistry } from '../src/main/tools/registry.js'
import { browserTools } from '../src/main/tools/browser/index.js'
import { isResearchSourceUrl, presentSearch } from '../src/main/tools/search/presentation.js'
import type { ToolResult } from '../src/main/tools/tool.js'

const profile = process.env.CLOSEDAI_BROWSER_CHECK_PROFILE
if (!profile) throw new Error('Run through scripts/browser-live-check.mjs')

const watchdogMs = Number(process.env.CLOSEDAI_BROWSER_CHECK_TIMEOUT_MS ?? 30_000)

app.setPath('userData', profile)

function textOf(result: ToolResult): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

function jsonOf(result: ToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>
}

async function waitFor(predicate: () => boolean, timeoutMs: number, stepMs = 50): Promise<void> {
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += stepMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

function fixtureServer(): Promise<{ server: Server; base: string }> {
  const apiBody = JSON.stringify({ data: { items: [{ name: 'Alpha', score: 1 }, { name: 'Beta', score: 2 }] } })
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const path = request.url?.split('?')[0] ?? '/'
      response.setHeader('content-type', 'text/html; charset=utf-8')
      if (path === '/api') {
        response.setHeader('content-type', 'application/json')
        response.end(apiBody)
        return
      }
      if (path === '/article') {
        response.end('<title>Fixture article</title><main>Retained source body for research presentation.</main>')
        return
      }
      response.end(
        '<!doctype html><title>Live browser verification</title>' +
        '<main>Fixture evidence for embedded_browser tools.</main>' +
        '<input name="q" value="" aria-label="Search fixture">' +
        '<a href="/article">Article</a>'
      )
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('fixture server failed to bind'))
      else resolve({ server, base: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function verify(): Promise<void> {
  await app.whenReady()
  const { server, base } = await fixtureServer()
  const articleUrl = `${base}/article`
  const serpUrl = 'https://www.google.com/search?q=fixture'

  assert.equal(isResearchSourceUrl(serpUrl), false, 'search-engine results pages are not research sources')
  assert.equal(isResearchSourceUrl(articleUrl), true, 'fixture article is an eligible research source')

  const window = new BrowserWindow({ show: false, width: 1280, height: 900 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 1280, height: 900, visible: true })

  const pageAccess = new BrowserPageAccess(() => browser)
  const networkAccess = new BrowserNetworkAccess(() => browser, () => null)
  const registry = new ToolRegistry([
    browserTools(() => pageAccess, () => networkAccess, () => networkAccess)
  ])
  const context = { threadId: 'thread', turnId: 'turn', callId: 'browser-live', paneId: 'pane', signal: new AbortController().signal }

  try {
    const serpPresentation = presentSearch((url) => browser.openNewTab(url, true), serpUrl, context)
    assert.equal(serpPresentation.state, 'failed')
    assert.match(String(serpPresentation.state === 'failed' ? serpPresentation.error : ''), /actual source URL/)

    const sourcePresentation = presentSearch((url) => browser.openNewTab(url, true), articleUrl, context)
    assert.equal(sourcePresentation.state, 'opened')
    const researchTabId = sourcePresentation.state === 'opened' ? sourcePresentation.tabId : null
    assert.ok(researchTabId)

    const navigate = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'navigate', url: base, wait_until: 'load', timeout_ms: 15_000 }
    }, context)
    assert.equal(navigate.isError, undefined, textOf(navigate))
    assert.match(textOf(navigate), /Live browser verification/)

    const tabId = browser.tabList().find((tab) => tab.active)?.id
    assert.ok(tabId)
    const contents = browser.contentsOf(tabId)
    assert.ok(contents)
    await waitFor(() => !contents.isLoading(), 10_000)

    const read = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'read_page', tab_id: tabId, max_chars: 8_000 }
    }, context)
    assert.equal(read.isError, undefined, textOf(read))
    assert.match(textOf(read), /Fixture evidence for embedded_browser tools/)

    const query = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'query', tab_id: tabId, selector: 'input[name="q"]', visible_only: true, max_matches: 1 }
    }, context)
    assert.equal(query.isError, undefined, textOf(query))
    assert.equal(Number(jsonOf(query).matched), 1)

    const evaluated = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: {
        action: 'evaluate',
        tab_id: tabId,
        expression: '({ title: document.title, href: location.href, hasInput: !!document.querySelector("input[name=q]") })'
      }
    }, context)
    assert.equal(evaluated.isError, undefined, textOf(evaluated))
    const evalJson = jsonOf(evaluated) as { ok?: boolean; value?: { title?: string; hasInput?: boolean } }
    assert.equal(evalJson.ok, true)
    assert.equal(evalJson.value?.title, 'Live browser verification')
    assert.equal(evalJson.value?.hasInput, true)

    const fetched = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'fetch', tab_id: tabId, url: '/api', method: 'GET' }
    }, context)
    assert.equal(fetched.isError, undefined, textOf(fetched))
    const fetchJson = jsonOf(fetched) as { status?: number; json?: { data?: { items?: unknown[] } } }
    assert.equal(fetchJson.status, 200)
    assert.equal(fetchJson.json?.data?.items?.length, 2)

    const extracted = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'extract', tab_id: tabId, url: '/api', path: 'data.items', fields: ['name'], limit: 1 }
    }, context)
    assert.equal(extracted.isError, undefined, textOf(extracted))
    assert.deepEqual((jsonOf(extracted) as { value?: unknown }).value, [{ name: 'Alpha' }])

    const network = await registry.call({
      namespace: 'embedded_browser',
      tool: 'network',
      arguments: { action: 'requests', tab_id: tabId, url_contains: '/api', max_requests: 10 }
    }, context)
    assert.equal(network.isError, undefined, textOf(network))
    const networkJson = jsonOf(network) as { returned?: number; requests?: Array<{ url?: string }> }
    assert.ok(Number(networkJson.returned) >= 1)
    assert.ok(networkJson.requests?.some((record) => String(record.url).includes('/api')))

    const session = await registry.call({
      namespace: 'embedded_browser',
      tool: 'session',
      arguments: { action: 'fetch', url: articleUrl, max_chars: 4_000 }
    }, context)
    assert.equal(session.isError, undefined, textOf(session))
    const sessionJson = jsonOf(session) as { status?: number; text?: string }
    assert.equal(sessionJson.status, 200)
    assert.match(String(sessionJson.text), /Retained source body/)

    const articleContents = browser.contentsOf(researchTabId)
    assert.ok(articleContents)
    await waitFor(() => !articleContents.isLoading() && articleContents.getTitle() === 'Fixture article', 10_000)
    assert.equal(articleContents.getTitle(), 'Fixture article')

    console.log(JSON.stringify({
      ok: true,
      fixture: base,
      researchTabId,
      articleUrl,
      serpRejected: true,
      networkRecords: networkJson.returned
    }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    browser.dispose()
    window.destroy()
    server.closeAllConnections()
    server.close()
    app.exit(process.exitCode ? 1 : 0)
  }
}

const watchdog = setTimeout(() => {
  console.error(`Live browser fixture exceeded ${watchdogMs}ms`)
  app.exit(1)
}, watchdogMs)

void verify().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
}).finally(() => clearTimeout(watchdog))
