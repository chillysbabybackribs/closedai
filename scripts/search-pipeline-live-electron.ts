import assert from 'node:assert/strict'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { BrowserService } from '../src/main/browser-service.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../src/main/browser-history-store.js'
import { BrowserNetworkAccess } from '../src/main/browser-network-access.js'
import { BrowserPageAccess } from '../src/main/browser-page-access.js'
import { createResearchRuntime } from '../src/main/research-runtime.js'
import { browserTools } from '../src/main/tools/browser/index.js'
import { ToolRegistry } from '../src/main/tools/registry.js'
import { readSearchKey } from '../src/main/tools/search/keyring.js'
import { isResearchSourceUrl } from '../src/main/tools/search/presentation.js'
import type { SearchProvider } from '../src/main/tools/search/types.js'
import type { ToolResult } from '../src/main/tools/tool.js'

const userData = profile
if (!userData) throw new Error('Run through scripts/search-pipeline-live-check.mjs')

const watchdogMs = Number(process.env.CLOSEDAI_SEARCH_PIPELINE_TIMEOUT_MS ?? 90_000)
const PROVIDERS: SearchProvider[] = ['brave', 'serper', 'tavily', 'you']

app.setPath('userData', userData)

function textOf(result: ToolResult): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

async function availableProvider(): Promise<SearchProvider> {
  for (const provider of PROVIDERS) {
    try {
      await readSearchKey(provider)
      return provider
    } catch {
      continue
    }
  }
  console.error('No search API credential found. Set BRAVE_SEARCH_API_KEY, SERPER_API_KEY, TAVILY_API_KEY, or YOU_API_KEY (or configure the Linux keyring accounts documented in docs/tools.md).')
  app.exit(2)
  throw new Error('unreachable')
}

async function verify(): Promise<void> {
  const provider = await availableProvider()
  await app.whenReady()

  const window = new BrowserWindow({ show: false, width: 1280, height: 900 })
  const browser = new BrowserService(window, EPHEMERAL_BROWSER_HISTORY, { initialUrl: 'about:blank' })
  browser.setBounds({ x: 0, y: 0, width: 1280, height: 900, visible: true })
  const runtime = await createResearchRuntime({
    root: join(userData, 'research-runs'),
    browser: () => browser,
    workspace: () => userData,
    peers: () => ({ paneSnapshot: () => ({ threadId: 'thread', activeTurnId: 'turn' }) }) as never
  })
  const pageAccess = new BrowserPageAccess(() => browser)
  const networkAccess = new BrowserNetworkAccess(() => browser, () => null)
  const registry = new ToolRegistry([
    runtime.namespace,
    browserTools(() => pageAccess, () => networkAccess, () => networkAccess)
  ])
  const context = {
    paneId: 'pane',
    threadId: 'thread',
    turnId: 'turn',
    callId: 'search-pipeline-live',
    signal: new AbortController().signal
  }

  try {
    const started = await registry.call({
      namespace: 'search',
      tool: 'run',
      arguments: {
        action: 'start',
        queries: [{
          query: 'MDN Web Fetch API documentation',
          intent: 'technical',
          depth: 'quick',
          providers: [provider],
          live: true,
          count: 5
        }],
        max_sources: 5,
        deadline_ms: 60_000,
        presentation: 'live'
      }
    }, context)
    assert.equal(started.isError, undefined, textOf(started))
    let snapshot = JSON.parse(textOf(started)) as {
      runId: string
      state: string
      cursor: number
      presentation: { state: string; tabId?: string; error?: string }
      sources: Array<{ id: string; url: string; state: string }>
    }

    for (let attempt = 0; attempt < 60; attempt++) {
      const ready = snapshot.sources.filter((source) => source.state === 'ready')
      if (snapshot.presentation.state === 'opened' && ready.length > 0) break
      if (snapshot.state !== 'running') break
      snapshot = await runtime.service.wait(snapshot.runId, context, snapshot.cursor, 2_000)
    }

    assert.equal(snapshot.presentation.state, 'opened', `presentation: ${JSON.stringify(snapshot.presentation)}`)
    assert.ok(snapshot.presentation.tabId, 'presentation tab id')

    const tabContents = browser.contentsOf(snapshot.presentation.tabId!)
    assert.ok(tabContents, 'presentation tab contents')
    const tabUrl = tabContents.getURL()
    assert.equal(isResearchSourceUrl(tabUrl), true, `presentation tab must be a source document, got ${tabUrl}`)
    assert.equal(isResearchSourceUrl('https://www.google.com/search?q=test'), false)

    const readySources = snapshot.sources.filter((source) => source.state === 'ready')
    assert.ok(readySources.length >= 1, `expected ready sources, got ${JSON.stringify(snapshot.sources)}`)
    for (const source of readySources) {
      assert.equal(isResearchSourceUrl(source.url), true, `source URL must be eligible: ${source.url}`)
    }

    const sourceId = readySources[0]!.id
    const excerpt = await registry.call({
      namespace: 'search',
      tool: 'read',
      arguments: { action: 'source', run_id: snapshot.runId, source_id: sourceId, max_chars: 2000 }
    }, context)
    assert.equal(excerpt.isError, undefined, textOf(excerpt))
    const excerptJson = JSON.parse(textOf(excerpt)) as { text?: string; source?: { url?: string } }
    assert.ok((excerptJson.text?.length ?? 0) > 80, 'source excerpt too short')

    const page = await registry.call({
      namespace: 'embedded_browser',
      tool: 'page',
      arguments: { action: 'read_page', tab_id: snapshot.presentation.tabId, max_chars: 4000 }
    }, context)
    assert.equal(page.isError, undefined, textOf(page))
    assert.ok(textOf(page).length > 80, 'live tab read_page too short')

    console.log(JSON.stringify({
      ok: true,
      provider,
      runId: snapshot.runId,
      runState: snapshot.state,
      presentationTabId: snapshot.presentation.tabId,
      presentationUrl: tabUrl,
      readySources: readySources.length,
      excerptChars: excerptJson.text?.length ?? 0,
      sourceUrl: excerptJson.source?.url ?? readySources[0]?.url
    }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    runtime.service.dispose()
    browser.dispose()
    window.destroy()
    app.exit(process.exitCode === 1 ? 1 : 0)
  }
}

const watchdog = setTimeout(() => {
  console.error(`Search pipeline live check exceeded ${watchdogMs}ms`)
  app.exit(1)
}, watchdogMs)

void verify().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
}).finally(() => clearTimeout(watchdog))
