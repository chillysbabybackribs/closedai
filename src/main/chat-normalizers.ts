import type {
  ChatAccount,
  ChatAttachmentSummary,
  ChatFileChange,
  ChatModel,
  ChatThreadSummary,
  ChatTranscriptItem
} from '../shared/chat.js'

export function normalizeAccount(value: unknown): ChatAccount | null {
  const account = recordOf(value)
  if (!account) return null
  const type = stringOf(account.type)
  if (type === 'chatgpt') return { type, email: nullableString(account.email), planType: nullableString(account.planType) }
  if (type === 'apiKey') return { type, email: null, planType: null }
  if (type === 'amazonBedrock') return { type, email: null, planType: null }
  return { type: 'other', email: null, planType: null }
}

export function normalizeModels(value: unknown): ChatModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const model = recordOf(entry)
    if (!model || typeof model.id !== 'string') return []
    return [{
      provider: 'codex',
      id: model.id,
      displayName: typeof model.displayName === 'string' ? model.displayName : model.id,
      description: stringOf(model.description),
      defaultReasoningEffort: stringOf(model.defaultReasoningEffort) || 'medium',
      supportedReasoningEfforts: normalizeReasoningEfforts(model.supportedReasoningEfforts),
      isDefault: model.isDefault === true
    }]
  })
}

function normalizeReasoningEfforts(value: unknown): ChatModel['supportedReasoningEfforts'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const option = recordOf(entry)
    const effort = stringOf(option?.reasoningEffort)
    return effort ? [{ reasoningEffort: effort, description: stringOf(option?.description) }] : []
  })
}

export function normalizeThreadSummaries(value: unknown): ChatThreadSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const thread = recordOf(entry)
    if (!thread || typeof thread.id !== 'string') return []
    if (nullableString(thread.parentThreadId)) return []
    const preview = stringOf(thread.preview).trim()
    const name = nullableString(thread.name)?.trim() || null
    return [{
      id: thread.id,
      title: name ?? firstLine(preview) ?? 'New chat',
      preview,
      createdAt: secondsToMs(thread.createdAt),
      updatedAt: secondsToMs(thread.updatedAt) || secondsToMs(thread.createdAt)
    }]
  })
}

export function normalizeItem(
  item: Record<string, unknown>,
  id: string,
  turnId: string | null,
  completed: boolean
): ChatTranscriptItem | null {
  switch (stringOf(item.type)) {
    case 'userMessage':
      return {
        type: 'user',
        id,
        turnId,
        text: textFromContent(item.content),
        ...attachmentsFromContent(item.content, id)
      }
    case 'agentMessage': {
      const phase = item.phase === 'commentary' || item.phase === 'final_answer' ? item.phase : null
      return { type: 'assistant', id, turnId, text: stringOf(item.text), phase, streaming: !completed }
    }
    case 'commandExecution':
      return {
        type: 'command',
        id,
        turnId,
        command: stringOf(item.command),
        cwd: stringOf(item.cwd),
        status: stringOf(item.status) || (completed ? 'completed' : 'inProgress'),
        output: nullableString(item.aggregatedOutput) ?? '',
        exitCode: typeof item.exitCode === 'number' ? item.exitCode : null
      }
    case 'fileChange':
      return {
        type: 'fileChange',
        id,
        turnId,
        status: stringOf(item.status) || (completed ? 'completed' : 'inProgress'),
        changes: normalizeFileChanges(item.changes)
      }
    case 'plan':
      return { type: 'plan', id, turnId, text: stringOf(item.text), streaming: !completed }
    case 'reasoning': {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((value): value is string => typeof value === 'string')
        : []
      return { type: 'reasoning', id, turnId, text: summary.join('\n'), streaming: !completed }
    }
    case 'mcpToolCall':
      return {
        type: 'tool',
        id,
        turnId,
        label: [stringOf(item.server), stringOf(item.tool)].filter(Boolean).join(' · ') || 'Tool call',
        detail: jsonPreview(item.arguments),
        status: stringOf(item.status)
      }
    case 'dynamicToolCall':
      return normalizeScreenshot(item, id, turnId) ?? {
        type: 'tool', id, turnId, label: dynamicToolLabel(item),
        detail: jsonPreview(item.arguments), status: stringOf(item.status)
      }
    case 'collabAgentToolCall':
      return {
        type: 'tool', id, turnId, label: stringOf(item.tool) || 'Collaboration',
        detail: nullableString(item.prompt) ?? '', status: stringOf(item.status)
      }
    case 'webSearch':
      return { type: 'tool', id, turnId, label: 'Web search', detail: stringOf(item.query), status: completed ? 'completed' : 'inProgress' }
    case 'imageView':
      return { type: 'tool', id, turnId, label: 'Viewed image', detail: stringOf(item.path), status: completed ? 'completed' : 'inProgress' }
    case 'contextCompaction':
      return { type: 'notice', id, turnId, text: 'Conversation context compacted', tone: 'info' }
    case 'enteredReviewMode':
      return { type: 'notice', id, turnId, text: `Review started: ${stringOf(item.review)}`, tone: 'info' }
    case 'exitedReviewMode':
      return { type: 'assistant', id, turnId, text: stringOf(item.review), phase: 'final_answer', streaming: false }
    default:
      return null
  }
}

export function cloneItem(item: ChatTranscriptItem): ChatTranscriptItem {
  if (item.type === 'fileChange') return { ...item, changes: item.changes.map((change) => ({ ...change })) }
  if (item.type === 'user' && item.attachments) {
    return { ...item, attachments: item.attachments.map((attachment) => ({ ...attachment })) }
  }
  return { ...item }
}

export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeFileChanges(value: unknown): ChatFileChange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const change = recordOf(entry)
    if (!change) return []
    return [{ path: stringOf(change.path), kind: stringOf(change.kind), diff: stringOf(change.diff) }]
  })
}

function textFromContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((entry) => {
    const content = recordOf(entry)
    if (!content) return []
    if (content.type === 'text' && typeof content.text === 'string') return [content.text]
    return []
  }).join('\n')
}

function attachmentsFromContent(value: unknown, itemId: string): { attachments?: ChatAttachmentSummary[] } {
  if (!Array.isArray(value)) return {}
  const attachments = value.flatMap((entry, index): ChatAttachmentSummary[] => {
    const content = recordOf(entry)
    if (!content) return []
    if (content.type === 'localImage' && typeof content.path === 'string') {
      return [{ id: `${itemId}:${index}`, kind: 'image', name: fileName(content.path), path: content.path, source: { type: 'path', path: content.path } }]
    }
    if (content.type === 'image' && typeof content.url === 'string') {
      return [{ id: `${itemId}:${index}`, kind: 'image', name: 'Pasted image', url: content.url, source: { type: 'url', url: content.url } }]
    }
    if (content.type === 'mention' && typeof content.path === 'string') {
      const name = typeof content.name === 'string' && content.name.trim() ? content.name : fileName(content.path)
      return [{ id: `${itemId}:${index}`, kind: 'file', name, path: content.path }]
    }
    return []
  })
  return attachments.length ? { attachments } : {}
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function firstLine(text: string): string | null {
  const line = text.split('\n')[0]?.trim() ?? ''
  if (!line) return null
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

function secondsToMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : 0
}

function jsonPreview(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    const text = JSON.stringify(value, null, 2)
    return text.length > 4_000 ? `${text.slice(0, 4_000)}…` : text
  } catch {
    return String(value)
  }
}

function normalizeScreenshot(
  item: Record<string, unknown>,
  id: string,
  turnId: string | null
): Extract<ChatTranscriptItem, { type: 'screenshot' }> | null {
  if (item.namespace !== 'closedai_ui' || item.tool !== 'capture' || item.status !== 'completed') return null
  const args = recordOf(item.arguments)
  const action = args?.action
  const surface = action === 'app_window' || action === 'browser_page' || action === 'crop' ? action : null
  if (!surface || !Array.isArray(item.contentItems)) return null
  let imageUrl = ''
  let caption = ''
  for (const raw of item.contentItems) {
    const content = recordOf(raw)
    if (content?.type === 'inputImage' && typeof content.imageUrl === 'string') imageUrl ||= content.imageUrl
    if (content?.type === 'inputText' && typeof content.text === 'string') caption ||= firstLine(content.text) ?? ''
  }
  if (!imageUrl) return null
  return { type: 'screenshot', id, turnId, imageUrl, surface, caption }
}

export function dynamicToolLabel(item: Record<string, unknown>): string {
  const tool = stringOf(item.tool)
  const namespace = stringOf(item.namespace)
  const args = recordOf(item.arguments)
  const action = stringOf(args?.action)

  if (namespace === 'search' || tool === 'query') return 'Web search'
  if (namespace === 'embedded_browser' || (tool === 'page' && !namespace)) {
    if (action === 'navigate') return 'Open page'
    if (action === 'wait_for') return 'Wait for page'
    return 'Read page'
  }
  if (namespace === 'browser_cdp') {
    if (action === 'inspect_page') return 'Analyze page'
    if (action === 'click') return 'Click element'
    if (action === 'type') return 'Type text'
    if (action === 'scroll') return 'Scroll page'
    if (action === 'press_key') return 'Press key'
    if (tool === 'protocol') return 'Browser protocol'
    return 'Analyze page'
  }
  if (namespace === 'closedai_app') {
    if (tool === 'inspect' || action === 'inspect_app') return 'Analyze app'
    if (action === 'click') return 'Click app element'
    if (action === 'type') return 'Type in app'
    if (action === 'wait_for') return 'Wait for app'
    if (action === 'scroll') return 'Scroll app'
    if (action === 'press_key') return 'Press app key'
    return 'Use app'
  }
  if (namespace === 'closedai_workspace' || tool === 'inspect') {
    return 'Analyze workspace'
  }
  if (namespace === 'closedai_ui' || tool === 'capture') {
    return 'Capture'
  }
  if (tool === 'page') return 'Read page'
  return tool || 'Tool call'
}
