import type { ChatPeerSummary, ChatWorkspaceEvent } from '../shared/chat-peers.js'
import type { ChatSnapshot, ChatTranscriptItem } from '../shared/chat.js'
import type {
  AppBrowserTabRequest,
  AppBrowserTabs,
  AppChatWorkspace,
  AppCommandHost,
  AppDownloadList,
  AppOpenChatRequest,
  AppSendRequest,
  AppSendResult,
  AppStateSection,
  AppWindowInfo
} from './tools/app/host.js'

// Deterministic app state and commands for models, built on the same main-process services
// the renderer's IPC handlers call. Nothing here touches the DOM: a command either changes
// app state or fails with a reason, and `state` projects that state compactly.

export type AppCommandDeps = {
  chat: () => AppChatWorkspace | null
  browser: () => AppBrowserTabs | null
  downloads: () => AppDownloadList | null
  window: () => AppWindowInfo | null
}

const PEER_LIMIT = 12
const TAB_LIMIT = 16
const DOWNLOAD_LIMIT = 8

export class AppCommandAccess implements AppCommandHost {
  constructor(private readonly deps: AppCommandDeps) {}

  state(sections: readonly AppStateSection[], paneId: string | undefined, callerPaneId: string | null): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const chat = this.deps.chat()
    if (sections.includes('workspace')) result.workspace = chat ? projectWorkspace(chat, callerPaneId) : null
    if (sections.includes('chat')) {
      if (!chat) result.chat = null
      else {
        const targetPane = paneId ?? chat.snapshot().selectedPaneId
        const snapshot = chat.paneSnapshot(targetPane)
        result.chat = snapshot ? projectChat(targetPane, snapshot) : { paneId: targetPane, error: 'Unknown pane' }
      }
    }
    if (sections.includes('browser')) {
      const browser = this.deps.browser()
      result.browser = browser ? projectBrowser(browser) : null
    }
    if (sections.includes('downloads')) {
      const downloads = this.deps.downloads()?.list() ?? []
      result.downloads = {
        count: downloads.length,
        items: downloads.slice(0, DOWNLOAD_LIMIT).map((download) => ({
          id: download.id, filename: download.filename, state: download.state,
          receivedBytes: download.receivedBytes, totalBytes: download.totalBytes
        }))
      }
    }
    if (sections.includes('window')) {
      const window = this.deps.window()
      result.window = window ? {
        focused: window.isFocused(), visible: window.isVisible(), maximized: window.isMaximized(), bounds: window.getBounds()
      } : null
    }
    return result
  }

  selectedPaneId(): string {
    return this.chat().snapshot().selectedPaneId
  }

  async newChat(): Promise<{ paneId: string }> {
    return { paneId: await this.chat().newPeer() }
  }

  async sendMessage(request: AppSendRequest): Promise<AppSendResult> {
    const chat = this.chat()
    const started = Date.now()
    let turnStarted = chat.paneSnapshot(request.paneId)?.activeTurnId !== null
    if (turnStarted) throw new Error(`Pane ${request.paneId} is already running a turn; stop it or wait for state.chat.running to clear`)
    let settle: (() => void) | null = null
    const completed = new Promise<void>((resolve) => { settle = resolve })
    const listener = (event: ChatWorkspaceEvent): void => {
      if (event.type !== 'pane' || event.paneId !== request.paneId || event.event.type !== 'turn') return
      if (event.event.turnId) turnStarted = true
      else if (turnStarted) settle?.()
    }
    chat.on('event', listener)
    try {
      await chat.send(request.paneId, request.text, [])
      if (chat.paneSnapshot(request.paneId)?.activeTurnId) turnStarted = true
      if (!request.awaitTurn) return { paneId: request.paneId, turnStarted, turnCompleted: false, elapsedMs: Date.now() - started }
      const idle = turnStarted && chat.paneSnapshot(request.paneId)?.activeTurnId === null
      const turnCompleted = idle || await raceTimeout(completed, request.timeoutMs, request.signal)
      return { paneId: request.paneId, turnStarted, turnCompleted, elapsedMs: Date.now() - started }
    } finally {
      chat.off('event', listener)
    }
  }

  async stopAgent(paneId: string): Promise<void> {
    await this.chat().interrupt(paneId)
  }

  async openChat(request: AppOpenChatRequest): Promise<{ paneId: string; threadId: string | null }> {
    const chat = this.chat()
    const paneId = request.paneId ?? chat.snapshot().selectedPaneId
    if (request.paneId && !request.threadId && !request.title) {
      await chat.selectPane(request.paneId)
      return { paneId: request.paneId, threadId: chat.paneSnapshot(request.paneId)?.threadId ?? null }
    }
    let threadId = request.threadId
    if (!threadId) {
      const needle = request.title?.trim().toLowerCase()
      if (!needle) throw new Error('Pass pane_id, thread_id, or title')
      const hits = (await chat.listThreads()).filter((thread) => thread.title.toLowerCase().includes(needle))
      if (hits.length === 0) throw new Error(`No thread title contains "${request.title}"`)
      if (hits.length > 1) {
        const listed = hits.slice(0, 6).map((thread) => `${thread.id}: ${thread.title.slice(0, 60)}`).join(' | ')
        throw new Error(`${hits.length} threads match "${request.title}"; pass thread_id. ${listed}`)
      }
      threadId = hits[0]!.id
    }
    await chat.openThread(paneId, threadId)
    if (paneId !== chat.snapshot().selectedPaneId) await chat.selectPane(paneId)
    return { paneId, threadId }
  }

  async closeChat(paneId: string): Promise<void> {
    await this.chat().closePeer(paneId)
  }

  async selectModel(paneId: string, modelId: string, effort: string | undefined): Promise<void> {
    const chat = this.chat()
    await chat.selectModel(paneId, modelId)
    if (effort) await chat.selectReasoningEffort(paneId, effort)
  }

  async browserTab(request: AppBrowserTabRequest): Promise<unknown> {
    const browser = this.deps.browser()
    if (!browser) throw new Error('The browser is not available yet')
    const requireTab = (): string => {
      if (!request.tabId) throw new Error(`browser_tab ${request.op} needs tab_id`)
      if (!browser.tabList().some((tab) => tab.id === request.tabId)) throw new Error(`Unknown tab ${request.tabId}`)
      return request.tabId
    }
    switch (request.op) {
      case 'new': request.url ? browser.openNewTab(request.url, true) : browser.newTab(); break
      case 'new_right': browser.newTabToRight(requireTab()); break
      case 'select': browser.selectTab(requireTab()); break
      case 'close': browser.closeTab(requireTab()); break
      case 'close_others': browser.closeOtherTabs(requireTab()); break
      case 'close_right': browser.closeTabsToRight(requireTab()); break
      case 'duplicate': browser.duplicateTab(requireTab()); break
      case 'back': browser.back(); break
      case 'forward': browser.forward(); break
      case 'reload': request.tabId ? browser.reloadTab(requireTab()) : browser.reload(); break
      case 'rename': browser.renameTab(requireTab(), request.title ?? null); break
    }
    return projectBrowser(browser)
  }

  private chat(): AppChatWorkspace {
    const chat = this.deps.chat()
    if (!chat) throw new Error('The chat workspace is not available yet')
    return chat
  }
}

function projectWorkspace(chat: AppChatWorkspace, callerPaneId: string | null): Record<string, unknown> {
  const snapshot = chat.snapshot()
  // A workspace accumulates idle "New chat" panes, and a relaunch stamps them all with the same
  // updatedAt. Rank the panes a caller acts on first, then real conversations over empty
  // placeholders, so the pane it just created or is driving is never the one the limit drops.
  const rank = (peer: ChatPeerSummary): number => (
    (peer.paneId === snapshot.selectedPaneId ? 8 : 0) + (peer.paneId === callerPaneId ? 4 : 0) +
    (peer.running ? 2 : 0) + (peer.threadId ? 1 : 0)
  )
  // Panes are the attached chats; detached records are history and stay out of the pane list.
  const panes = snapshot.chats.filter((chat) => chat.attached)
  const ranked = [...panes].sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt)
  const shown = ranked.slice(0, PEER_LIMIT)
  return {
    selectedPaneId: snapshot.selectedPaneId,
    callerPaneId,
    paneCount: panes.length,
    ...(panes.length > shown.length ? { omittedPanes: panes.length - shown.length } : {}),
    panes: shown.map((peer) => ({
      paneId: peer.paneId,
      ...(peer.parentPaneId ? { parentPaneId: peer.parentPaneId } : {}),
      kind: peer.kind,
      provider: peer.provider,
      modelId: peer.modelId,
      title: peer.title.slice(0, 80),
      running: peer.running,
      ...(peer.activity ? { activity: peer.activity.slice(0, 80) } : {}),
      threadId: peer.threadId,
      updatedAt: peer.updatedAt
    }))
  }
}

export function projectChat(paneId: string, snapshot: ChatSnapshot): Record<string, unknown> {
  const lastUser = lastItem(snapshot.items, 'user')
  const lastAssistant = lastItem(snapshot.items, 'assistant')
  const lastNotice = lastItem(snapshot.items, 'notice')
  return {
    paneId,
    provider: snapshot.provider,
    connection: snapshot.connection.state,
    model: snapshot.selectedModel,
    reasoningEffort: snapshot.selectedReasoningEffort,
    threadId: snapshot.threadId,
    threadName: snapshot.threadName,
    running: snapshot.activeTurnId !== null,
    activeTurnId: snapshot.activeTurnId,
    ...(snapshot.pausedTurnId ? { pausedTurnId: snapshot.pausedTurnId } : {}),
    contextUsage: snapshot.contextUsage ? {
      usedTokens: snapshot.contextUsage.usedTokens,
      contextWindow: snapshot.contextUsage.contextWindow,
      percent: snapshot.contextUsage.percent
    } : null,
    itemCount: snapshot.items.length,
    ...(lastUser ? { lastUser: lastUser.slice(0, 160) } : {}),
    ...(lastAssistant ? { lastAssistant: lastAssistant.slice(0, 300) } : {}),
    ...(lastNotice ? { lastNotice: lastNotice.slice(0, 160) } : {})
  }
}

function lastItem(items: ChatTranscriptItem[], type: 'user' | 'assistant' | 'notice'): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.type === type) return item.text.replace(/\s+/g, ' ').trim()
  }
  return null
}

export function projectBrowser(browser: AppBrowserTabs): Record<string, unknown> {
  const state = browser.snapshot()
  const tabs = browser.tabList()
  return {
    active: {
      url: state.url, title: state.title.slice(0, 80), isLoading: state.isLoading,
      canGoBack: state.canGoBack, canGoForward: state.canGoForward,
      ...(state.navigationError ? { navigationError: state.navigationError } : {})
    },
    tabCount: tabs.length,
    tabs: tabs.slice(0, TAB_LIMIT).map((tab) => ({
      id: tab.id, pos: tab.pos, title: tab.title.slice(0, 60), url: tab.url.slice(0, 160),
      active: tab.active, isLoading: tab.isLoading
    }))
  }
}

async function raceTimeout(done: Promise<void>, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => finish(false), timeoutMs)
    const onAbort = (): void => { cleanup(); reject(new Error('send_message was aborted while awaiting the turn')) }
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
    const finish = (value: boolean): void => { cleanup(); resolve(value) }
    signal.addEventListener('abort', onAbort, { once: true })
    void done.then(() => finish(true))
  })
}
