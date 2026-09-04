import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { BrowserPageAccess } from '../src/main/browser-page-access.js'
import { BrowserNetworkAccess } from '../src/main/browser-network-access.js'
import { HOME_URL } from '../src/main/browser-url.js'
import { ToolRegistry } from '../src/main/tools/registry.js'
import { browserTools } from '../src/main/tools/browser/index.js'
import type { ToolResult } from '../src/main/tools/tool.js'

const profile = process.env.CLOSEDAI_BROWSER_CHECK_PROFILE
if (!profile) throw new Error('Run through scripts/browser-live-check.mjs')

const watchdogMs = Number(process.env.CLOSEDAI_BROWSER_CHECK_TIMEOUT_MS ?? 45_000)

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

async function verify(): Promise<void> {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 1280, height: 900 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 1280, height: 900, visible: true })

  const pageAccess = new BrowserPageAccess(() => browser)
  const networkAccess = new BrowserNetworkAccess(() => browser, () => null)
  const registry = new ToolRegistry([
    browserTools(() => pageAccess, () => networkAccess, () => networkAccess)
  ])
  const context = { threadId: null, turnId: null, callId: 'browser-live', signal: new AbortController().signal }

  try {
    const navigate = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'navigate', url: HOME_URL, wait_until: 'load', timeout_ms: 15_000 }
    }, context)
    assert.equal(navigate.isError, undefined, textOf(navigate))
    assert.match(textOf(navigate), /Loaded:/)

    const tabId = browser.tabList().find((tab) => tab.active)?.id
    assert.ok(tabId, 'active tab after navigation')

    const contents = browser.contentsOf(tabId)
    assert.ok(contents, 'web contents for active tab')
    await waitFor(() => !contents.isLoading() && contents.getTitle().length > 0, 30_000)

    const read = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'read_page', tab_id: tabId, max_chars: 8_000 }
    }, context)
    assert.equal(read.isError, undefined, textOf(read))
    const readText = textOf(read)
    assert.ok(readText.length > 120, `read_page returned too little text (${readText.length} chars)`)

    const query = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: {
        action: 'query',
        tab_id: tabId,
        selector: 'textarea[name="q"], input[name="q"]',
        visible_only: true,
        max_matches: 3
      }
    }, context)
    assert.equal(query.isError, undefined, textOf(query))
    assert.ok(Number(jsonOf(query).matched) >= 1, `expected search control on ${HOME_URL}`)

    const evaluated = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: {
        action: 'evaluate',
        tab_id: tabId,
        expression: '({ title: document.title, hasSearch: !!document.querySelector("[name=q]"), url: location.href })'
      }
    }, context)
    assert.equal(evaluated.isError, undefined, textOf(evaluated))
    const evalJson = jsonOf(evaluated) as { ok?: boolean; value?: { title?: string; hasSearch?: boolean; url?: string } }
    assert.equal(evalJson.ok, true)
    assert.equal(evalJson.value?.hasSearch, true)

    const network = await registry.call({
      namespace: 'embedded_browser',
      tool: 'network',
      arguments: { action: 'requests', tab_id: tabId, max_requests: 30 }
    }, context)
    assert.equal(network.isError, undefined, textOf(network))
    const networkJson = jsonOf(network) as { returned?: number; requests?: Array<{ url?: string }> }
    assert.ok(Number(networkJson.returned) >= 1, 'expected network records after navigation')

    const session = await registry.call({
      namespace: 'embedded_browser',
      tool: 'session',
      arguments: { action: 'fetch', url: HOME_URL, max_chars: 4_000 }
    }, context)
    assert.equal(session.isError, undefined, textOf(session))
    const sessionJson = jsonOf(session) as { status?: number }
    assert.ok(
      typeof sessionJson.status === 'number' && sessionJson.status >= 200 && sessionJson.status < 400,
      `session fetch failed with status ${String(sessionJson.status)}`
    )

    console.log(JSON.stringify({
      ok: true,
      url: HOME_URL,
      tabId,
      title: evalJson.value?.title ?? contents.getTitle(),
      readChars: readText.length,
      networkRecords: networkJson.returned,
      sessionStatus: sessionJson.status
    }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    browser.dispose()
    window.destroy()
    app.exit(process.exitCode ? 1 : 0)
  }
}

const watchdog = setTimeout(() => {
  console.error(`Live browser check exceeded ${watchdogMs}ms`)
  app.exit(1)
}, watchdogMs)

void verify().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
}).finally(() => clearTimeout(watchdog))
