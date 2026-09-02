import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatAttachment, ChatAttachmentSummary } from '../../shared/chat.js'
import { buildChatInput } from '../chat-input.js'
import type { AdditionalContext } from '../chat-context/turn-context.js'

// One user turn for the CLI's stream-json stdin, whose message content is plain text. The
// validation and attachment summaries come from the same buildChatInput the other lanes use;
// app context leads as tagged blocks, attached files are listed by path for the model's own
// file tools, and pasted images are written to the state dir so they have a path too.

export type AntigravityUserTurn = {
  prompt: string
  summaries: ChatAttachmentSummary[]
  /** The stdin message content: context, attachments, then the user's words. */
  content: string
}

/** Null when there is nothing to send (no text and no attachments). */
export async function buildAntigravityPrompt(
  text: string,
  attachments: ChatAttachment[],
  context: AdditionalContext | undefined,
  stateDir: string
): Promise<AntigravityUserTurn | null> {
  const { prompt, input, summaries } = buildChatInput(text, attachments)
  if (input.length === 0) return null
  const parts: string[] = contextBlocks(context)
  const files: string[] = []
  for (const entry of input) {
    if (entry.type === 'localImage' || entry.type === 'mention') files.push(entry.path)
    else if (entry.type === 'image') {
      const path = await materializeImage(entry.url, stateDir)
      if (path) files.push(path)
    }
  }
  if (files.length) parts.push(`Attached files (read them with view_file):\n${files.map((path) => `- ${path}`).join('\n')}`)
  if (prompt) parts.push(prompt)
  return { prompt, summaries, content: parts.join('\n\n') }
}

/** Codex receives turn context as tagged fragments; Antigravity gets the same fragments as tagged text. */
export function contextBlocks(context: AdditionalContext | undefined): string[] {
  if (!context) return []
  return Object.entries(context).map(([name, fragment]) => `<closedai_context name="${name}" kind="${fragment.kind}">\n${fragment.value}\n</closedai_context>`)
}

async function materializeImage(url: string, stateDir: string): Promise<string | null> {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/s.exec(url)
  if (!match) return null
  try {
    const dir = join(stateDir, 'attachments')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`)
    await writeFile(path, Buffer.from(match[2]!, 'base64'))
    return path
  } catch {
    return null
  }
}
