export type ChatConnectionState = 'starting' | 'ready' | 'signed-out' | 'unavailable' | 'error'

export type ChatConnection = {
  state: ChatConnectionState
  message: string
}

/**
 * Which chat backend owns a model or thread. Codex is the app-server; Claude is the Claude Agent
 * SDK; Antigravity is Google's `agy` CLI on the user's Antigravity subscription.
 */
export type ChatProvider = 'codex' | 'claude' | 'antigravity'

export type ChatAccount = {
  type: 'chatgpt' | 'apiKey' | 'amazonBedrock' | 'claude' | 'google' | 'other'
  email: string | null
  planType: string | null
}

export type ChatModel = {
  provider: ChatProvider
  /** Unique across providers; Claude and Antigravity ids carry a prefix (see chat-providers.ts) so the hub routes without a lookup. */
  id: string
  displayName: string
  description: string
  defaultReasoningEffort: string
  supportedReasoningEfforts: ChatReasoningEffort[]
  isDefault: boolean
}

export type ChatReasoningEffort = {
  reasoningEffort: string
  description: string
}

export type ChatAttachment = {
  id: string
  name: string
} & (
  | { kind: 'file'; path: string }
  | { kind: 'image'; source: { type: 'path'; path: string } | { type: 'url'; url: string } }
)

export type ChatAttachmentSummary = Pick<ChatAttachment, 'id' | 'kind' | 'name'> & {
  path?: string
  url?: string
  source?: { type: 'path'; path: string } | { type: 'url'; url: string }
}

export type ChatFileChange = {
  path: string
  kind: string
  diff: string
}

/**
 * Wall-clock bounds of a command, file change, or tool call, stamped by the app when it
 * first sees the item running and when it settles. Items replayed from provider history
 * arrive already settled and carry neither, so no duration is invented for them.
 * Unix milliseconds.
 */
export type ActivityTiming = {
  startedAt?: number
  finishedAt?: number
}

export type ActivityPhase = 'running' | 'pending' | 'failed' | 'done'

/** Providers report free-form status strings; every consumer reads them through this one mapping. */
export function activityPhase(status: string, exitCode: number | null = null): ActivityPhase {
  const normalized = status.toLowerCase()
  if (normalized.includes('progress') || normalized.includes('running')) return 'running'
  if (normalized.includes('fail') || normalized.includes('error') || (exitCode !== null && exitCode !== 0)) return 'failed'
  if (normalized.includes('pending') || normalized.includes('request')) return 'pending'
  return 'done'
}

export type ChatTranscriptItem =
  | { type: 'user'; id: string; turnId: string | null; text: string; attachments?: ChatAttachmentSummary[] }
  | {
      type: 'assistant'
      createdAt?: number
      id: string
      turnId: string | null
      text: string
      phase: 'commentary' | 'final_answer' | null
      streaming: boolean
    }
  | {
      type: 'command'
      id: string
      turnId: string | null
      command: string
      cwd: string
      status: string
      output: string
      exitCode: number | null
    } & ActivityTiming
  | {
      type: 'fileChange'
      id: string
      turnId: string | null
      status: string
      changes: ChatFileChange[]
    } & ActivityTiming
    | { type: 'plan'; id: string; turnId: string | null; text: string; streaming: boolean }
    | { type: 'reasoning'; id: string; turnId: string | null; text: string; streaming: boolean }
  | {
      type: 'tool'
      background?: {
        taskId: string
        kind: 'agent' | 'command' | 'task'
        linkedToolId?: string
        progress?: string
        durationMs?: number
      }
      id: string
      turnId: string | null
      label: string
      detail: string
      status: string
      /** Result text, or the error message when the call failed. Clipped by the adapter. */
      output?: string
    } & ActivityTiming
  | {
      /** Visual evidence produced by a capture tool. Display-only in the app transcript. */
      type: 'screenshot'
      id: string
      turnId: string | null
      imageUrl: string
      surface: 'app_window' | 'browser_page' | 'crop'
      caption: string
    }
  | { type: 'notice'; id: string; turnId: string | null; text: string; tone: 'info' | 'error' }

/** One row of the chat history list, sorted newest-first by the main process. */
export type ChatThreadSummary = {
  id: string
  /** User-set name when there is one, else the first user message, else a placeholder. */
  title: string
  preview: string
  /** Unix milliseconds. */
  createdAt: number
  updatedAt: number
}

/** Read-only history used to build a compact continuation without resuming the source thread. */
export type ChatThreadContent = {
  threadId: string
  threadName: string | null
  items: ChatTranscriptItem[]
}

/** How full the model's context window was after the latest model response. */
export type ChatContextUsage = {
  usedTokens: number
  contextWindow: number
  /** 0–100, rounded. */
  percent: number
}

/** One subscription window a provider reports, e.g. the 5-hour or weekly bucket. */
export type ChatPlanUsageWindow = {
  /** How the provider names the window: '5-hour', 'Weekly', 'Weekly (Opus)'. */
  label: string
  /** 0–100, rounded. */
  percent: number
  /** Epoch ms the window rolls over, when the provider says. */
  resetsAt: number | null
}

/**
 * The signed-in plan's usage, as the provider reports it. Separate from `ChatContextUsage`:
 * that is this thread's window, this is the account's quota across every thread and device.
 */
export type ChatPlanUsage = {
  /** Plan name the provider reports ('Pro', 'Max', 'prolite'), when it names one. */
  plan: string | null
  windows: ChatPlanUsageWindow[]
  /** An aside the windows do not carry, e.g. a credit balance. */
  note: string | null
  /** Why there are no windows; set only when the provider cannot report them. */
  unavailable: string | null
  /** Epoch ms these numbers were read, so a stale reading can say so. */
  updatedAt: number
}

export type ChatTurnContextAttachment = {
  name: string
  kind: 'file' | 'image'
  delivery: string
  /** Present for path-backed attachments; pasted image bytes are never copied into this report. */
  path?: string
}

export type ChatTurnContextAddition = {
  name: string
  kind: 'application' | 'untrusted'
  value: string
  characters: number
  estimatedTokens: number
}

/** What ClosedAI contributed to the latest provider turn, excluding provider-owned history. */
export type ChatTurnContextReport = {
  createdAt: number
  provider: ChatProvider
  model: string | null
  threadId: string | null
  message: { value: string; characters: number; estimatedTokens: number }
  attachments: ChatTurnContextAttachment[]
  additions: ChatTurnContextAddition[]
  estimatedAddedTextTokens: number
  retainedHistory: string
}

export const CHAT_HISTORY_PAGE_SIZE = 200

export type ChatHistoryWindow = { beforeItemId?: string; limit: number }
export type ChatHistoryPage = { items: ChatTranscriptItem[]; hasEarlier: boolean; backgroundTasks?: ChatTranscriptItem[] }

export type ChatSnapshot = {
  /** The provider whose thread the pane shows; its connection and account are the ones below. */
  provider: ChatProvider
  connection: ChatConnection
  account: ChatAccount | null
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  cwd: string
  threadId: string | null
  /** User-facing thread title from the app-server, when one has been set. */
  threadName: string | null
  activeTurnId: string | null
  contextUsage: ChatContextUsage | null
  /** The account's plan usage; null until the provider answers, and cached between readings. */
  planUsage: ChatPlanUsage | null
  /** Latest turn submitted since this provider surface was opened. */
  turnContext: ChatTurnContextReport | null
  items: ChatTranscriptItem[]
  /** Present on windowed renderer snapshots; provider history remains complete. */
  history?: { hasEarlier: boolean; title?: string; backgroundTasks?: ChatTranscriptItem[] }
}

export type ChatEvent =
  | { type: 'replace'; snapshot: ChatSnapshot }
  | {
      type: 'connection'
      provider: ChatProvider
      connection: ChatConnection
      account: ChatAccount | null
      /** Every provider's models merged, so the picker can switch providers from any state. */
      models: ChatModel[]
      selectedModel: string | null
      selectedReasoningEffort: string | null
    }
  | { type: 'model'; selectedModel: string; selectedReasoningEffort: string | null }
  | { type: 'reasoningEffort'; selectedReasoningEffort: string }
  | { type: 'thread'; threadId: string | null; threadName: string | null }
  | { type: 'turn'; turnId: string | null }
  | { type: 'context'; usage: ChatContextUsage | null }
  | { type: 'planUsage'; usage: ChatPlanUsage | null }
  | { type: 'turnContext'; report: ChatTurnContextReport }
  | { type: 'item'; item: ChatTranscriptItem; appended?: boolean }
  | { type: 'itemDelta'; itemId: string; field: 'text' | 'output'; delta: string }
