import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import type { ChatWorkspaceSnapshot } from '../shared/chat-peers.ts'
import type { ChatSnapshot, ChatThreadSummary } from '../shared/chat.ts'
import { AppCommandAccess } from './app-commands.ts'
import type { AppBrowserTabs, AppChatWorkspace } from './tools/app/host.ts'

function chatSnapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    provider: 'codex',
    connection: { state: 'ready', message: '' },
    account: null,
    models: [],
    selectedModel: 'gpt-5',
    selectedReasoningEffort: 'high',
    cwd: '/repo',
    threadId: 'thread-1',
    threadName: null,
    activeTurnId: null,
    contextUsage: { usedTokens: 1000, contextWindow: 200000, percent: 1 },
    turnContext: null,
    items: [
      { type: 'user', id: 'u1', turnId: 't1', text: 'hello   there' },
      { type: 'assistant', id: 'a1', turnId: 't1', text: 'Hi! '.repeat(200), streaming: false }
    ],
    ...overrides
  } as ChatSnapshot
}

class FakeWorkspace extends EventEmitter implements AppChatWorkspace {
  calls: unknown[] = []
  panes = new Map<string, ChatSnapshot>([['pane-1', chatSnapshot()], ['pane-2', chatSnapshot({ threadId: 'thread-2' })]])
  selected = 'pane-1'
  threads: ChatThreadSummary[] = [
    { id: 'thread-2', title: 'Benchmark run', preview: '', createdAt: 1, updatedAt: 2 },
    { id: 'thread-3', title: 'Benchmark rerun', preview: '', createdAt: 1, updatedAt: 3 }
  ] as ChatThreadSummary[]

  snapshot(): ChatWorkspaceSnapshot {
    return {
      selectedPaneId: this.selected,
      selected: this.panes.get(this.selected)!,
      peers: [...this.panes].map(([paneId, snapshot]) => ({
        paneId, parentPaneId: null, kind: 'peer', provider: 'codex', modelId: snapshot.selectedModel,
        threadId: snapshot.threadId, title: `Pane ${paneId}`, preview: '', running: snapshot.activeTurnId !== null,
        activity: null, updatedAt: 5
      }))
    }
  }
  paneSnapshot(paneId: string): ChatSnapshot | null { return this.panes.get(paneId) ?? null }
  async newPeer(): Promise<string> { this.panes.set('pane-3', chatSnapshot({ threadId: null })); this.selected = 'pane-3'; return 'pane-3' }
  async send(paneId: string, text: string): Promise<void> {
    this.calls.push(['send', paneId, text])
    this.panes.set(paneId, chatSnapshot({ activeTurnId: 'turn-9' }))
    this.emit('event', { type: 'pane', paneId, event: { type: 'turn', turnId: 'turn-9' } })
  }
  finish(paneId: string): void {
    this.panes.set(paneId, chatSnapshot({ activeTurnId: null }))
    this.emit('event', { type: 'pane', paneId, event: { type: 'turn', turnId: null } })
  }
  async interrupt(paneId: string): Promise<void> { this.calls.push(['interrupt', paneId]) }
  async selectPane(paneId: string): Promise<void> { this.calls.push(['selectPane', paneId]); this.selected = paneId }
  async openThread(paneId: string, threadId: string): Promise<void> { this.calls.push(['openThread', paneId, threadId]) }
  async closePeer(paneId: string): Promise<void> { this.calls.push(['closePeer', paneId]) }
  async selectModel(paneId: string, modelId: string): Promise<void> { this.calls.push(['selectModel', paneId, modelId]) }
  async selectReasoningEffort(paneId: string, effort: string): Promise<void> { this.calls.push(['effort', paneId, effort]) }
  async listThreads(): Promise<ChatThreadSummary[]> { return this.threads }
}

function browser(): AppBrowserTabs & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    tabList: () => [{ id: '1', pos: 1, title: 'Google', url: 'https://google.com', favicon: null, isLoading: false, active: true }],
    snapshot: () => ({ url: 'https://google.com', title: 'Google', isLoading: false, canGoBack: false, canGoForward: false }),
    newTab: () => { calls.push(['newTab']) },
    openNewTab: (input, activate) => { calls.push(['openNewTab', input, activate]) },
    selectTab: (id) => { calls.push(['selectTab', id]) },
    closeTab: (id) => { calls.push(['closeTab', id]) },
    back: () => { calls.push(['back']) },
    forward: () => { calls.push(['forward']) },
    reload: () => { calls.push(['reload']) }
  }
}

function access(workspace = new FakeWorkspace(), tabs = browser()) {
  return {
    workspace, tabs,
    host: new AppCommandAccess({ chat: () => workspace, browser: () => tabs, downloads: () => ({ list: () => [] }), window: () => null })
  }
}

test('state projects the workspace and a chat pane compactly', () => {
  const { host } = access()
  const state = host.state(['workspace', 'chat', 'browser', 'downloads', 'window'], undefined, 'pane-1')
  const workspace = state.workspace as { panes: unknown[]; callerPaneId: string; selectedPaneId: string }
  assert.equal(workspace.selectedPaneId, 'pane-1')
  assert.equal(workspace.callerPaneId, 'pane-1')
  assert.equal(workspace.panes.length, 2)
  const chat = state.chat as Record<string, unknown>
  assert.equal(chat.running, false)
  assert.equal(chat.lastUser, 'hello there')
  assert.equal((chat.lastAssistant as string).length, 300)
  assert.equal(chat.itemCount, 2)
  assert.deepEqual(state.downloads, { count: 0, items: [] })
  assert.equal(state.window, null)
  assert.equal((state.browser as { tabCount: number }).tabCount, 1)
  assert.deepEqual(host.state(['chat'], 'missing', null).chat, { paneId: 'missing', error: 'Unknown pane' })
  assert.equal(JSON.stringify(state).length < 1_500, true)
})

test('send_message awaits the turn and reports completion or timeout without failing', async () => {
  const { host, workspace } = access()
  const signal = new AbortController().signal
  const pending = host.sendMessage({ paneId: 'pane-2', text: 'go', awaitTurn: true, timeoutMs: 5_000, signal })
  await new Promise((resolve) => setTimeout(resolve, 10))
  workspace.finish('pane-2')
  const done = await pending
  assert.equal(done.turnStarted, true)
  assert.equal(done.turnCompleted, true)
  assert.deepEqual(workspace.calls, [['send', 'pane-2', 'go']])

  const slow = await host.sendMessage({ paneId: 'pane-2', text: 'again', awaitTurn: true, timeoutMs: 20, signal })
  assert.equal(slow.turnCompleted, false)
  assert.equal(slow.turnStarted, true)
  assert.equal(workspace.listenerCount('event'), 0)

  await assert.rejects(
    host.sendMessage({ paneId: 'pane-2', text: 'busy', awaitTurn: false, timeoutMs: 20, signal }),
    /already running a turn/
  )
})

test('open_chat resolves panes, thread ids, and unique titles', async () => {
  const { host, workspace } = access()
  assert.deepEqual(await host.openChat({ paneId: 'pane-2' }), { paneId: 'pane-2', threadId: 'thread-2' })
  assert.deepEqual(await host.openChat({ title: 'rerun' }), { paneId: 'pane-2', threadId: 'thread-3' })
  await assert.rejects(host.openChat({ title: 'benchmark' }), /2 threads match "benchmark"; pass thread_id\. thread-2: Benchmark run \| thread-3: Benchmark rerun/)
  await assert.rejects(host.openChat({ title: 'nothing' }), /No thread title contains/)
  await assert.rejects(host.openChat({}), /Pass pane_id, thread_id, or title/)
  assert.deepEqual(workspace.calls, [['selectPane', 'pane-2'], ['openThread', 'pane-2', 'thread-3']])
})

test('model, close, and browser commands call the underlying services', async () => {
  const { host, workspace, tabs } = access()
  await host.selectModel('pane-1', 'claude-opus-5', 'max')
  await host.closeChat('pane-2')
  await host.browserTab({ op: 'new', url: 'https://example.com' })
  await host.browserTab({ op: 'select', tabId: '1' })
  await assert.rejects(host.browserTab({ op: 'close', tabId: '9' }), /Unknown tab 9/)
  await assert.rejects(host.browserTab({ op: 'close' }), /needs tab_id/)
  assert.deepEqual(workspace.calls, [['selectModel', 'pane-1', 'claude-opus-5'], ['effort', 'pane-1', 'max'], ['closePeer', 'pane-2']])
  assert.deepEqual(tabs.calls, [['openNewTab', 'https://example.com', true], ['selectTab', '1']])
})
