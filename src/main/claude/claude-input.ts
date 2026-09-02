import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatAttachment, ChatAttachmentSummary } from '../../shared/chat.js'
import { buildChatInput } from '../chat-input.js'
import type { AdditionalContext } from '../chat-context/turn-context.js'

// One user turn for the SDK's streaming input. Validation and attachment summaries come from
// the same buildChatInput the Codex lane uses; only the wire shape differs: Anthropic content
// blocks, with app context ahead of the user's own words so the model reads state first.

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export type ClaudeUserTurn = {
  prompt: string
  summaries: ChatAttachmentSummary[]
  message: SDKUserMessage
}

/** Null when there is nothing to send (no text and no attachments). */
export async function buildClaudeUserMessage(
  text: string,
  attachments: ChatAttachment[],
  context: AdditionalContext | undefined,
  sessionId: string | null
): Promise<ClaudeUserTurn | null> {
  const { prompt, input, summaries } = buildChatInput(text, attachments)
  if (input.length === 0) return null
  const blocks: ContentBlock[] = contextBlocks(context)
  const files: string[] = []
  for (const entry of input) {
    if (entry.type === 'localImage') {
      const image = await imageFromPath(entry.path)
      if (image) blocks.push(image)
      else files.push(entry.path)
    } else if (entry.type === 'image') {
      const image = imageFromDataUrl(entry.url)
      if (image) blocks.push(image)
    } else if (entry.type === 'mention') {
      files.push(entry.path)
    }
  }
  if (files.length) {
    blocks.push({ type: 'text', text: `Attached files (read them with the Read tool):\n${files.map((path) => `- ${path}`).join('\n')}` })
  }
  if (prompt) blocks.push({ type: 'text', text: prompt })
  return {
    prompt,
    summaries,
    message: {
      type: 'user',
      message: { role: 'user', content: blocks.length === 1 && blocks[0]!.type === 'text' ? blocks[0].text : blocks },
      parent_tool_use_id: null,
      session_id: sessionId ?? ''
    }
  }
}

/** Codex receives turn context as tagged fragments; Claude gets the same fragments as tagged text. */
export function contextBlocks(context: AdditionalContext | undefined): ContentBlock[] {
  if (!context) return []
  return Object.entries(context).map(([name, fragment]) => ({
    type: 'text',
    text: `<closedai_context name="${name}" kind="${fragment.kind}">\n${fragment.value}\n</closedai_context>`
  }))
}

async function imageFromPath(path: string): Promise<ContentBlock | null> {
  const mediaType = IMAGE_MEDIA_TYPES[extname(path).toLowerCase()]
  if (!mediaType) return null
  try {
    const bytes = await readFile(path)
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } }
  } catch {
    return null
  }
}

export function imageFromDataUrl(url: string): ContentBlock | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/s.exec(url)
  return match ? { type: 'image', source: { type: 'base64', media_type: match[1]!, data: match[2]! } } : null
}
