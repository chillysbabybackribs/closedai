import { isAbsolute } from 'node:path'
import type { ChatAttachment, ChatAttachmentSummary } from '../shared/chat.js'

const MAX_ATTACHMENTS = 20
const MAX_DATA_URL_LENGTH = 28_000_000

export type ChatUserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string }
  | { type: 'image'; url: string }
  | { type: 'mention'; name: string; path: string }

export function buildChatInput(text: string, attachments: ChatAttachment[]): {
  prompt: string
  input: ChatUserInput[]
  summaries: ChatAttachmentSummary[]
} {
  const prompt = typeof text === 'string' ? text.trim() : ''
  if (!Array.isArray(attachments)) throw new Error('Invalid attachments')
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`Attach no more than ${MAX_ATTACHMENTS} files at once`)

  const input: ChatUserInput[] = prompt ? [{ type: 'text', text: prompt, text_elements: [] }] : []
  const summaries: ChatAttachmentSummary[] = []
  for (const attachment of attachments) {
    const name = validName(attachment)
    const id = typeof attachment?.id === 'string' && attachment.id ? attachment.id : crypto.randomUUID()
    if (attachment.kind === 'file') {
      input.push({ type: 'mention', name, path: validPath(attachment.path) })
    } else if (attachment.kind === 'image' && attachment.source?.type === 'path') {
      input.push({ type: 'localImage', path: validPath(attachment.source.path) })
    } else if (attachment.kind === 'image' && attachment.source?.type === 'url') {
      input.push({ type: 'image', url: validImageUrl(attachment.source.url) })
    } else {
      throw new Error('Invalid attachment')
    }
    summaries.push({ id, kind: attachment.kind, name })
  }
  return { prompt, input, summaries }
}

function validName(attachment: ChatAttachment): string {
  const name = typeof attachment?.name === 'string' ? attachment.name.trim() : ''
  if (!name || name.length > 255 || /[\r\n]/.test(name)) throw new Error('Invalid attachment name')
  return name
}

function validPath(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('Invalid attachment path')
  return path
}

function validImageUrl(url: string): string {
  if (typeof url !== 'string' || !url.startsWith('data:image/') || url.length > MAX_DATA_URL_LENGTH) {
    throw new Error('Pasted image is invalid or too large')
  }
  return url
}
