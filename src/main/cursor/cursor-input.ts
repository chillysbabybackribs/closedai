import type { ChatAttachment, ChatAttachmentSummary } from '../../shared/chat.js'
import { imageBytesFromDataUrl, imageBytesFromPath } from '../chat-image-bytes.js'
import { buildChatInput } from '../chat-input.js'
import type { AdditionalContext } from '../chat-context/turn-context.js'
import type { AcpPromptBlock } from './cursor-acp.js'

// One user turn as ACP prompt blocks. Validation and attachment summaries come from the same
// buildChatInput the Codex lane uses; only the wire shape differs. ACP takes a flat array of
// content blocks, and `promptCapabilities.image` was true on the account probed, so pasted
// screenshots go over as image blocks rather than as paths the agent would have to read back.
// App context leads, so the model reads state before the user's own words.

export type CursorUserTurn = {
  prompt: string
  summaries: ChatAttachmentSummary[]
  blocks: AcpPromptBlock[]
}

/** Null when there is nothing to send (no text and no attachments). */
export async function buildCursorPrompt(
  text: string,
  attachments: ChatAttachment[],
  context: AdditionalContext | undefined,
  options: { images: boolean } = { images: true }
): Promise<CursorUserTurn | null> {
  const { prompt, input, summaries } = buildChatInput(text, attachments)
  if (input.length === 0) return null
  const blocks: AcpPromptBlock[] = contextBlocks(context)
  const files: string[] = []
  for (const entry of input) {
    if (entry.type === 'localImage') {
      const image = options.images ? await imageBytesFromPath(entry.path) : null
      if (image) blocks.push({ type: 'image', mimeType: image.mimeType, data: image.base64 })
      else files.push(entry.path)
    } else if (entry.type === 'image') {
      const image = options.images ? imageBytesFromDataUrl(entry.url) : null
      if (image) blocks.push({ type: 'image', mimeType: image.mimeType, data: image.base64 })
    } else if (entry.type === 'mention') {
      files.push(entry.path)
    }
  }
  if (files.length) {
    blocks.push({
      type: 'text',
      text: `Attached files (read them with your file tools):\n${files.map((path) => `- ${path}`).join('\n')}`
    })
  }
  if (prompt) blocks.push({ type: 'text', text: prompt })
  return { prompt, summaries, blocks }
}

/** Codex receives turn context as tagged fragments; Cursor gets the same fragments as tagged text. */
export function contextBlocks(context: AdditionalContext | undefined): AcpPromptBlock[] {
  if (!context) return []
  return Object.entries(context).map(([name, fragment]) => ({
    type: 'text' as const,
    text: `<closedai_context name="${name}" kind="${fragment.kind}">\n${fragment.value}\n</closedai_context>`
  }))
}
