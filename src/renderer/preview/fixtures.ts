import type { ChatSnapshot, ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatRowSummary, ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { initialChatState } from '../chat-state.js'
import { withBrowser, type SavedChatLayout } from '../chat-layout/layout-tree.js'

export const SCENARIOS = ['conversation', 'empty', 'streaming', 'settings', 'split'] as const
export type Scenario = typeof SCENARIOS[number]
export const PREVIEW_CWD = '/preview/closedai'

export function parseScenario(value: string | null): Scenario {
  if (value === null) return 'conversation'
  if (SCENARIOS.includes(value as Scenario)) return value as Scenario
  throw new Error(`Unknown preview scenario: ${value}. Choose ${SCENARIOS.join(', ')}.`)
}

export function sampleChat(id: string, empty = false): ChatSnapshot {
  const items: ChatTranscriptItem[] = empty ? [] : [
    { type: 'user', id: `${id}-user`, turnId: 'sample-turn', text: 'Help me review the workspace layout and summarize the changes.' },
    { type: 'tool', id: `${id}-tool`, turnId: 'sample-turn', label: 'Read layout files',
      detail: 'Sample activity for UI development', status: 'completed', output: 'Found the chat and browser layout components.' },
    { type: 'assistant', id: `${id}-answer`, turnId: 'sample-turn', phase: 'final_answer', streaming: false,
      text: 'The workspace keeps conversations and the browser together.\n\n- Drag a tab to rearrange your chats.\n- Resize adjacent panes with the divider.\n- Open settings to adjust text size.\n\n| Area | Status |\n| --- | --- |\n| Chat layout | Ready for review |\n| Composer | Ready for review |\n\nThis is sample content for the browser UI preview.' }
  ]
  return { ...initialChatState(), connection: { state: 'ready', message: 'UI preview — simulated provider' },
    models: [{ id: 'preview-model', provider: 'codex', displayName: 'Preview model',
      description: 'Local sample responses; no provider calls', contextWindow: 200_000,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'Sample default' },
        { reasoningEffort: 'high', description: 'Sample high effort' }
      ], isDefault: true }], selectedModel: 'preview-model', selectedReasoningEffort: 'medium',
    cwd: PREVIEW_CWD, threadId: id, threadName: empty ? 'New chat' : 'Workspace layout review',
    contextUsage: { usedTokens: 12_000, contextWindow: 200_000, percent: 6 }, items,
    history: { hasEarlier: false } }
}

export function sampleRow(id: string, chat: ChatSnapshot): ChatRowSummary {
  return { paneId: id, parentPaneId: null, kind: 'peer', provider: chat.provider,
    modelId: chat.selectedModel, threadId: chat.threadId, title: chat.threadName ?? 'New chat',
    preview: 'Sample conversation for UI testing', running: chat.activeTurnId !== null,
    activity: chat.activeTurnId ? 'Writing a sample response' : null, updatedAt: 1_790_000_000_000,
    attached: true, pinnedAt: null, cwd: PREVIEW_CWD, projectPath: PREVIEW_CWD,
    createdAt: 1_790_000_000_000, lastTurnEndedAt: null }
}

function sampleClosed(id: string, title: string, endedAt: number, cwd: string): ChatRowSummary {
  const chat = sampleChat(id)
  chat.threadName = title
  return { ...sampleRow(id, chat), attached: false, running: false, activity: null,
    updatedAt: endedAt + 86_400_000, lastTurnEndedAt: endedAt, cwd, projectPath: cwd }
}

export function sampleWorkspace(scenario: Scenario): ChatWorkspaceSnapshot {
  const first = sampleChat('preview-chat-1', scenario === 'empty')
  const second = sampleChat('preview-chat-2')
  second.threadName = 'Composer review'
  const panes = { 'preview-chat-1': first, 'preview-chat-2': second }
  const open = Object.entries(panes).map(([id, chat]) => sampleRow(id, chat))
  const now = Date.now()
  const closed = scenario === 'empty' ? [] : [
    sampleClosed('preview-closed-1', 'PDF table extraction', now - 2 * 3_600_000, '/projects/notes'),
    sampleClosed('preview-closed-2', 'Auth token refresh', now - 3 * 86_400_000, PREVIEW_CWD),
    sampleClosed('preview-closed-3', 'Invoice layout pass', now - 14 * 86_400_000, '/projects/billing')
  ]
  return { selectedPaneId: 'preview-chat-1', selected: first, panes,
    chats: [...open, ...closed],
    workspace: { cwd: PREVIEW_CWD, projectPath: PREVIEW_CWD, recentProjects: [] },
    preferences: { chatSeamlessRotation: true } }
}

export function sampleLayout(scenario: Scenario): SavedChatLayout {
  return { browserVisible: scenario === 'split', tree: withBrowser(scenario === 'split'
    ? { kind: 'split', id: 'preview-split', axis: 'vertical', ratio: 0.5,
        first: { kind: 'pane', id: 'preview-chat-1' }, second: { kind: 'pane', id: 'preview-chat-2' } }
    : { kind: 'pane', id: 'preview-chat-1', tabs: ['preview-chat-1', 'preview-chat-2'] }) }
}
