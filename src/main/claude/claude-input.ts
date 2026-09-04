import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatAttachment, ChatAttachmentSummary } from '../../shared/chat.js'
import { imageBytesFromDataUrl, imageBytesFromPath, type ImageMimeType } from '../chat-image-bytes.js'
import { buildChatInput } from '../chat-input.js'
import type { AdditionalContext } from '../chat-context/turn-context.js'

// One user turn for the SDK's streaming input. Validation and attachment summaries come from
// the same buildChatInput the Codex lane uses; only the wire shape differs: Anthropic content
// blocks, with app context ahead of the user's own words so the model reads state first.

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMimeType; data: string } }

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
  return imageBlock(await imageBytesFromPath(path))
}

export function imageFromDataUrl(url: string): ContentBlock | null {
  return imageBlock(imageBytesFromDataUrl(url))
}

function imageBlock(bytes: { mimeType: ImageMimeType; base64: string } | null): ContentBlock | null {
  return bytes ? { type: 'image', source: { type: 'base64', media_type: bytes.mimeType, data: bytes.base64 } } : null
}
