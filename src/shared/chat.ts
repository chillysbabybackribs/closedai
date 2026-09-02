export type ChatConnectionState = 'starting' | 'ready' | 'signed-out' | 'unavailable' | 'error'

export type ChatConnection = {
  state: ChatConnectionState
  message: string
}

export type ChatAccount = {
  type: 'chatgpt' | 'apiKey' | 'amazonBedrock' | 'other'
  email: string | null
  planType: string | null
}

export type ChatModel = {
  id: string
  displayName: string
  description: string
  defaultReasoningEffort: string
  isDefault: boolean
}

export type ChatAttachment = {
  id: string
  name: string
} & (
  | { kind: 'file'; path: string }
  | { kind: 'image'; source: { type: 'path'; path: string } | { type: 'url'; url: string } }
)

export type ChatAttachmentSummary = Pick<ChatAttachment, 'id' | 'kind' | 'name'>

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
  | { type: 'plan'; id: string; turnId: string | null; text: string }
  | { type: 'reasoning'; id: string; turnId: string | null; text: string }
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
  connection: ChatConnection
  account: ChatAccount | null
  models: ChatModel[]
  selectedModel: string | null
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
  | { type: 'connection'; connection: ChatConnection; account: ChatAccount | null; models: ChatModel[]; selectedModel: string | null }
  | { type: 'model'; selectedModel: string }
  | { type: 'thread'; threadId: string | null; threadName: string | null }
  | { type: 'turn'; turnId: string | null }
  | { type: 'context'; usage: ChatContextUsage | null }
  | { type: 'item'; item: ChatTranscriptItem }
  | { type: 'itemDelta'; itemId: string; field: 'text' | 'output'; delta: string }
