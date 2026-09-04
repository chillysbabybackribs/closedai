import { session } from 'electron'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserService } from './browser-service.js'
import type { ChatPeerManager } from './chat-peers/peer-manager.js'
import { searchTools } from './tools/search/index.js'
import type { ResearchService } from './tools/search/research/service.js'
import { SourceStore } from './tools/search/research/source-reader.js'
import { SearchBrowserTabs } from './tools/search/presentation.js'

/** Electron/session ownership stays outside the provider-neutral search implementation. */
export async function createResearchRuntime(options: {
  root: string
  browser(): BrowserService | null
  peers(): ChatPeerManager | null
  workspace(): string
}) {
  // Runs are session-local. Remove only our UUID-named cache directories from earlier launches.
  const entries = await readdir(options.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return []
  })
  for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
    await rm(join(options.root, entry.name), { recursive: true, force: true })
  }
  const publicSession = session.fromPartition('research-public')
  const store = new SourceStore(options.root, (input, init) => publicSession.fetch(input as string, init))
  let service!: ResearchService
  const liveTabs = new SearchBrowserTabs({
    exists: (tabId) => options.browser()?.tabList().some((tab) => tab.id === tabId) ?? false,
    open: (url) => {
      const browser = options.browser()
      if (!browser) throw new Error('The live browser is unavailable')
      return browser.openNewTab(url, true)
    }
  })
  const namespace = searchTools({
    onResearchCreated: (created) => { service = created },
    research: {
      owner: (context) => {
        if (!context.paneId || !context.threadId) throw new Error('Research requires an identified chat pane and thread')
        const snapshot = options.peers()?.paneSnapshot(context.paneId)
        if (!snapshot || snapshot.threadId !== context.threadId) throw new Error('The research caller is no longer in this conversation')
        return {
          paneId: context.paneId, threadId: context.threadId, workspace: options.workspace(),
          turnId: snapshot.activeTurnId === context.turnId ? context.turnId : null
        }
      },
      collect: (url, runId, sourceId, signal) => store.collect(url, runId, sourceId, signal),
      read: (runId, sourceId) => store.read(runId, sourceId),
      remove: (runId) => store.remove(runId),
      openLive: (url, context) => {
        const snapshot = context.paneId ? options.peers()?.paneSnapshot(context.paneId) : null
        if (!snapshot || snapshot.threadId !== context.threadId || snapshot.activeTurnId !== context.turnId) {
          throw new Error('The live search caller is no longer in this turn')
        }
        return liveTabs.open(url, context)
      }
    }
  })
  return { namespace, service }
}
