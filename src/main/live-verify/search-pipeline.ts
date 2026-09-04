import assert from 'node:assert/strict'
import { HOME_URL } from '../browser-url.js'
import type { ToolRegistry } from '../tools/registry.js'
import { readSearchKey } from '../tools/search/keyring.js'
import { isResearchSourceUrl } from '../tools/search/presentation.js'
import type { ResearchService } from '../tools/search/research/service.js'
import type { SearchProvider } from '../tools/search/types.js'
import type { ToolResult } from '../tools/tool.js'

const PROVIDERS: SearchProvider[] = ['brave', 'serper', 'tavily', 'you']

function textOf(result: ToolResult): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

async function firstProvider(): Promise<SearchProvider> {
  for (const provider of PROVIDERS) {
    try {
      await readSearchKey(provider)
      return provider
    } catch {
      continue
    }
  }
  throw new Error('No search API credential (BRAVE_SEARCH_API_KEY, SERPER_API_KEY, TAVILY_API_KEY, or YOU_API_KEY)')
}

export async function runBrowserLiveVerify(registry: ToolRegistry): Promise<Record<string, unknown>> {
  const context = { threadId: null, turnId: null, callId: 'live-verify-browser', signal: new AbortController().signal }
  const navigate = await registry.call({
    namespace: 'embedded_browser',
    tool: 'page',
    arguments: { action: 'navigate', url: HOME_URL, wait_until: 'load', timeout_ms: 15_000 }
  }, context)
  assert.equal(navigate.isError, undefined, textOf(navigate))
  const read = await registry.call({
    namespace: 'embedded_browser',
    tool: 'page',
    arguments: { action: 'read_page', max_chars: 4000 }
  }, context)
  assert.equal(read.isError, undefined, textOf(read))
  assert.ok(textOf(read).length > 80)
  return { ok: true, url: HOME_URL, readChars: textOf(read).length }
}

export async function runSearchPipelineLiveVerify(
  registry: ToolRegistry,
  research: ResearchService
): Promise<Record<string, unknown>> {
  const provider = await firstProvider()
  const context = {
    paneId: 'live-verify-pane',
    threadId: 'live-verify-thread',
    turnId: 'live-verify-turn',
    callId: 'live-verify-search',
    signal: new AbortController().signal
  }
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
    presentation: { state: string; tabId?: string }
    sources: Array<{ id: string; url: string; state: string }>
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = snapshot.sources.filter((source) => source.state === 'ready')
    if (snapshot.presentation.state === 'opened' && ready.length > 0) break
    if (snapshot.state !== 'running') break
    snapshot = await research.wait(snapshot.runId, context, snapshot.cursor, 2_000)
  }
  assert.equal(snapshot.presentation.state, 'opened')
  assert.ok(snapshot.presentation.tabId)
  const ready = snapshot.sources.filter((source) => source.state === 'ready')
  assert.ok(ready.length >= 1)
  for (const source of ready) assert.equal(isResearchSourceUrl(source.url), true)
  const excerpt = await registry.call({
    namespace: 'search',
    tool: 'read',
    arguments: { action: 'source', run_id: snapshot.runId, source_id: ready[0]!.id, max_chars: 2000 }
  }, context)
  assert.equal(excerpt.isError, undefined, textOf(excerpt))
  const excerptJson = JSON.parse(textOf(excerpt)) as { text?: string }
  assert.ok((excerptJson.text?.length ?? 0) > 80)
  const page = await registry.call({
    namespace: 'embedded_browser',
    tool: 'page',
    arguments: { action: 'read_page', tab_id: snapshot.presentation.tabId, max_chars: 4000 }
  }, context)
  assert.equal(page.isError, undefined, textOf(page))
  return {
    ok: true,
    provider,
    runId: snapshot.runId,
    presentationTabId: snapshot.presentation.tabId,
    readySources: ready.length,
    sourceUrl: ready[0]?.url,
    excerptChars: excerptJson.text?.length ?? 0
  }
}

export async function runLiveVerify(
  mode: string,
  registry: ToolRegistry,
  research: ResearchService | null
): Promise<Record<string, unknown>> {
  if (mode === 'browser') return runBrowserLiveVerify(registry)
  if (mode === 'search-pipeline') {
    if (!research) throw new Error('Research service is not ready')
    return runSearchPipelineLiveVerify(registry, research)
  }
  throw new Error(`Unknown CLOSEDAI_LIVE_VERIFY mode: ${mode}`)
}
