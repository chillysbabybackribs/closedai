import type {
  ChatAttachmentSummary,
  ChatProvider,
  ChatTurnContextAttachment,
  ChatTurnContextReport
} from '../../shared/chat.js'
import type { AdditionalContext } from './turn-context.js'

const HISTORY_DESCRIPTIONS: Record<ChatProvider, string> = {
  codex: 'Codex replays its native thread: retained messages, tool calls and results, and image inputs. Older history may be compacted.',
  claude: 'Claude resumes its native SDK session, including retained messages and tool interactions. The SDK may compact older history.',
  antigravity: 'Antigravity resumes its native CLI conversation, including the history retained by that provider.'
}

export type TurnContextReportInput = {
  provider: ChatProvider
  model: string | null
  threadId: string | null
  prompt: string
  attachments: ChatAttachmentSummary[]
  additionalContext?: AdditionalContext
  createdAt?: number
}

/** Build a safe, renderer-facing account of the app-controlled portion of one model turn. */
export function buildTurnContextReport(input: TurnContextReportInput): ChatTurnContextReport {
  const additions = Object.entries(input.additionalContext ?? {}).map(([name, fragment]) => ({
    name,
    kind: fragment.kind,
    value: fragment.value,
    characters: fragment.value.length,
    estimatedTokens: estimateTokens(fragment.value)
  }))
  const attachments = input.attachments.map((attachment) => attachmentReport(input.provider, attachment))
  const messageTokens = estimateTokens(input.prompt)
  return {
    createdAt: input.createdAt ?? Date.now(),
    provider: input.provider,
    model: input.model,
    threadId: input.threadId,
    message: { value: input.prompt, characters: input.prompt.length, estimatedTokens: messageTokens },
    attachments,
    additions,
    estimatedAddedTextTokens: messageTokens + additions.reduce((total, addition) => total + addition.estimatedTokens, 0),
    retainedHistory: HISTORY_DESCRIPTIONS[input.provider]
  }
}

export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0
}

function attachmentReport(provider: ChatProvider, attachment: ChatAttachmentSummary): ChatTurnContextAttachment {
  const path = attachment.path ?? (attachment.source?.type === 'path' ? attachment.source.path : undefined)
  return {
    name: attachment.name,
    kind: attachment.kind,
    delivery: delivery(provider, attachment),
    ...(path ? { path } : {})
  }
}

function delivery(provider: ChatProvider, attachment: ChatAttachmentSummary): string {
  if (attachment.kind === 'file') {
    return provider === 'codex' ? 'Path mention; contents are read only if the model uses a file tool.'
      : provider === 'claude' ? 'Path reference in the message; contents are read only with the Read tool.'
        : 'Path reference in the message; contents are read only with view_file.'
  }
  if (provider === 'codex') return 'Image input sent to Codex.'
  if (provider === 'claude') return 'Image bytes embedded in the current Claude message.'
  return 'Image materialized as a local file and referenced by path for view_file.'
}
