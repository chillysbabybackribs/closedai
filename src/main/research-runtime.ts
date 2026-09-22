import { session } from 'electron'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserService } from './browser-service.js'
import { createHiddenPageWorker, RESEARCH_PARTITION } from './browser-workers/hidden-page-worker.js'
import { readRenderedPage } from './browser-workers/rendered-reader.js'
import { BrowserWorkerPool } from './browser-workers/worker-pool.js'
import type { ChatPeerManager } from './chat-peers/peer-manager.js'
import { searchTools } from './tools/search/index.js'
import type { ResearchService } from './tools/search/research/service.js'
import { SourceStore } from './tools/search/research/source-reader.js'
import { createPdfReader } from './tools/search/research/pdf/reader.js'
import { createPdfInspector } from './tools/search/research/pdf/inspector.js'
import { textLimit } from './tools/search/research/coverage.js'
import { SearchBrowserTabs } from './tools/search/presentation.js'
import { ResearchLibrary } from './research-library/service.js'
import { traceLog } from './trace/trace-log.js'
import type { BrowserCoordination } from './tools/browser/coordination.js'

/** Electron/session ownership stays outside the provider-neutral search implementation. */
export async function createResearchRuntime(options: {
  root: string
  libraryPath: string
  browser(): BrowserService | null
  peers(): ChatPeerManager | null
  workspace(): string
  browserCoordination?: BrowserCoordination
}) {
  // Runs are session-local. Remove only our UUID-named cache directories from earlier launches.
  const entries = await readdir(options.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return []
  })
  for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
    await rm(join(options.root, entry.name), { recursive: true, force: true })
  }
  const publicSession = session.fromPartition(RESEARCH_PARTITION)
  const library = ResearchLibrary.create(options.libraryPath, (input, init) => publicSession.fetch(input as string, init))
  const store = new SourceStore(options.root, (input, init) => publicSession.fetch(input as string, init),
    createPdfReader(new URL('./pdf-worker.js', import.meta.url)))
  const inspectPdf = createPdfInspector(new URL('./pdf-page-worker.js', import.meta.url))
  const workers = new BrowserWorkerPool(createHiddenPageWorker)
  let service!: ResearchService
  const liveTabs = new SearchBrowserTabs({
    exists: (tabId, context) => !!options.browser()?.tabList().some((tab) => tab.id === tabId) &&
      (options.browserCoordination?.canUse(tabId, context.paneId!) ?? true),
    open: (url) => {
      const browser = options.browser()
      if (!browser) throw new Error('The live browser is unavailable')
      return browser.openNewTab(url, false)
    }
  })
  const namespace = searchTools({
    onResearchCreated: (created) => { service = created },
    research: {
      trace: (owner, event) => traceLog.record({ paneId: owner.paneId, turnId: owner.turnId, provider: null }, {
        kind: 'note', label: `research.${event.event}`, summary: `Research ${event.event}: ${Math.round(event.elapsedMs)} ms`,
        durationMs: event.durationMs, detail: event
      }),
      owner: (context) => {
        if (!context.paneId || !context.threadId) throw new Error('Research requires an identified chat pane and thread')
        const snapshot = options.peers()?.paneSnapshot(context.paneId)
        if (!snapshot || snapshot.threadId !== context.threadId) throw new Error('The research caller is no longer in this conversation')
        return {
          paneId: context.paneId, threadId: context.threadId, workspace: options.workspace(),
          turnId: snapshot.activeTurnId === context.turnId ? context.turnId : null
        }
      },
      collect: (url, runId, sourceId, signal, coverage) => store.collect(url, runId, sourceId, signal, coverage),
      render: async (url, runId, sourceId, signal, coverage) => {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        return store.retain(runId, sourceId, await readRenderedPage(workers, runId, url, deadline, textLimit(coverage)), 'rendered_text', coverage)
      },
      retain: (runId, sourceId, page, coverage) => store.retain(runId, sourceId, page, 'provider_text', coverage),
      replace: (runId, sourceId, stagedId) => store.replace(runId, sourceId, stagedId),
      discard: (runId, sourceId) => store.discard(runId, sourceId),
      read: (runId, sourceId) => store.read(runId, sourceId),
      inspectPdf: async (runId, sourceId, hash, request, signal) => inspectPdf(await store.pdfPath(runId, sourceId), hash, request, signal),
      remove: (runId) => store.remove(runId),
      openLive: (url, context) => {
        const snapshot = context.paneId ? options.peers()?.paneSnapshot(context.paneId) : null
        if (!snapshot || snapshot.threadId !== context.threadId || snapshot.activeTurnId !== context.turnId) {
          throw new Error('The live search caller is no longer in this turn')
        }
        const tabId = liveTabs.open(url, context)
        options.browserCoordination?.claim(tabId, context.paneId!)
        return tabId
      }
    }
  })
  return { namespace, service, library, dispose: () => { service.dispose(); workers.dispose() } }
}
