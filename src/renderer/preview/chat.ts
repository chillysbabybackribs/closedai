import type { ClosedaiApi } from '../../shared/api.js'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { sampleChat, sampleRow, sampleWorkspace, type Scenario } from './fixtures.js'

export function createPreviewChat(scenario: Scenario, report: (message: string) => void) {
  const state = sampleWorkspace(scenario)
  const listeners = new Set<(event: ChatWorkspaceEvent) => void>()
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  let sequence = 2
  let started = false
  const publish = () => {
    state.selected = state.panes![state.selectedPaneId]!
    state.chats = state.chats.map((row) => {
      const chat = state.panes?.[row.paneId]
      if (!chat) return row
      return { ...row, title: chat.threadName ?? 'New chat', modelId: chat.selectedModel,
        running: !!chat.activeTurnId, paused: !!chat.pausedTurnId,
        activity: chat.activeTurnId ? 'Writing a sample response' : null }
    })
    for (const listener of listeners) listener({ type: 'workspace', snapshot: structuredClone(state) })
  }
  const pane = (id: string): ChatSnapshot => {
    const chat = state.panes![id]
    if (!chat) throw new Error(`Unknown preview chat: ${id}`)
    return chat
  }
  const stop = (id: string) => { clearInterval(timers.get(id)); timers.delete(id) }
  const stream = (id: string) => {
    stop(id)
    const chat = pane(id)
    const turnId = `preview-turn-${++sequence}`
    chat.activeTurnId = turnId
    chat.pausedTurnId = null
    const answer = { type: 'assistant' as const, id: `${turnId}-answer`, turnId,
      phase: 'final_answer' as const, text: '', streaming: true }
    chat.items.push(answer)
    const words = 'This is a simulated streaming response. It exercises the real transcript, scrolling, activity indicator, and pause button without contacting a model. Edit the UI source and Vite will update this preview. You can send another message to replay the interaction.'.split(' ')
    publish()
    timers.set(id, setInterval(() => {
      const word = words.shift()
      if (word !== undefined) answer.text += `${answer.text ? ' ' : ''}${word}`
      else { answer.streaming = false; chat.activeTurnId = null; stop(id) }
      publish()
    }, 140))
  }
  const select = async (id: string) => { pane(id); state.selectedPaneId = id; publish() }
  const create = async () => {
    const id = `preview-chat-${++sequence}`
    const chat = sampleChat(id, true)
    state.panes![id] = chat
    state.chats.push(sampleRow(id, chat))
    await select(id)
    return id
  }
  const close = async (id: string) => {
    pane(id)
    stop(id)
    state.chats = state.chats.filter((row) => row.paneId !== id)
    delete state.panes![id]
    if (!state.chats.length) await create()
    else { if (state.selectedPaneId === id) state.selectedPaneId = state.chats[0]!.paneId; publish() }
  }
  const native = async () => { report('This action requires real Electron; it is unavailable in the UI preview.') }
  const api: ClosedaiApi['chat'] = {
    snapshot: async () => structuredClone(state),
    historyPage: async () => ({ items: [], hasEarlier: false }),
    send: async (id, text, attachments) => {
      const chat = pane(id)
      if (chat.activeTurnId) throw new Error('Pause the sample response before sending another message.')
      chat.items.push({ type: 'user', id: `preview-user-${++sequence}`, turnId: `preview-turn-${sequence + 1}`, text, attachments })
      stream(id)
    },
    attachmentPath: () => { report('Native file attachments require Electron.'); return '' },
    interrupt: async (id) => {
      stop(id)
      const chat = pane(id)
      chat.pausedTurnId = chat.activeTurnId
      chat.activeTurnId = null
      chat.items.forEach((item) => { if (item.type === 'assistant') item.streaming = false })
      publish()
    },
    selectPane: select, setVisiblePanes: async () => {},
    selectModel: async (id, model) => { pane(id).selectedModel = model; publish() },
    selectReasoningEffort: async (id, effort) => { pane(id).selectedReasoningEffort = effort; publish() },
    refreshPlanUsage: async () => {}, loginWithChatGPT: native,
    listChats: async () => structuredClone(state.chats), newPeer: create, closePeer: close,
    continueInNewPeer: create, openChat: async (id) => {
      if (!state.panes?.[id]) {
        const row = state.chats.find((entry) => entry.paneId === id)
        if (!row) throw new Error(`Unknown preview chat: ${id}`)
        const chat = sampleChat(id)
        chat.threadName = row.title
        state.panes![id] = chat
        row.attached = true
      }
      await select(id)
      return id
    }, archiveChat: close,
    setChatPinned: async (id, pinned) => {
      const row = state.chats.find((entry) => entry.paneId === id)
      if (row) row.pinnedAt = pinned ? Date.now() : null
      publish()
    },
    renameChat: async (id, title) => { pane(id).threadName = title?.trim() || 'New chat'; publish() },
    retryChatTitle: native, compactConversation: native, chooseProject: native, selectProject: native, clearProject: native,
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  }
  return { api, start: () => { if (!started && scenario === 'streaming') stream(state.selectedPaneId); started = true },
    dispose: () => { timers.forEach(clearInterval); timers.clear(); listeners.clear() } }
}
