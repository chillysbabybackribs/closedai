export type ChatConnectionState = 'starting' | 'ready' | 'signed-out' | 'unavailable' | 'error'

export type ChatConnection = {
  state: ChatConnectionState
  message: string
}

/** Which chat backend owns a model or thread. Codex is the app-server; Claude is the Claude Agent SDK. */
export type ChatProvider = 'codex' | 'claude'

export type ChatAccount = {
  type: 'chatgpt' | 'apiKey' | 'amazonBedrock' | 'claude' | 'other'
  email: string | null
  planType: string | null
}

export type ChatModel = {
  provider: ChatProvider
  /** Unique across providers; Claude ids carry a `claude:` prefix so the hub routes without a lookup. */
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

export type ChatTranscriptItem =
  | { type: 'user'; id: string; turnId: string | null; text: string; attachments?: ChatAttachmentSummary[] }
  | {
      type: 'assistant'
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
    }
  | {
      type: 'fileChange'
      id: string
      turnId: string | null
      status: string
      changes: ChatFileChange[]
    }
    | { type: 'plan'; id: string; turnId: string | null; text: string; streaming: boolean }
    | { type: 'reasoning'; id: string; turnId: string | null; text: string; streaming: boolean }
  | {
      type: 'tool'
      id: string
      turnId: string | null
      label: string
      detail: string
      status: string
    }
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

/** How full the model's context window was after the latest model response. */
export type ChatContextUsage = {
  usedTokens: number
  contextWindow: number
  /** 0–100, rounded. */
  percent: number
}

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
  items: ChatTranscriptItem[]
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
  | { type: 'item'; item: ChatTranscriptItem }
  | { type: 'itemDelta'; itemId: string; field: 'text' | 'output'; delta: string }
