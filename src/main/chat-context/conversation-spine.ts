import type { ChatTranscriptItem } from '../../shared/chat.js'
import { stripContextBlocks } from '../../shared/chat-display.js'
import type { ChatIndexLine } from '../../shared/chat-index.js'

export type ConversationSpineEntry = { id: string; speaker: 'User' | 'Assistant'; text: string }

export type ConversationSpineTurn = {
  userItemId: string
  userText: string
  assistant?: { itemId: string; text: string }
  plan?: { itemId: string; text: string }
  evidence: Array<{ itemId: string; text: string }>
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export function compactSpineEvidenceLine(item: ChatTranscriptItem): { itemId: string; text: string } | null {
  if (item.type === 'command') {
    return { itemId: item.id, text: `command: ${clip(item.command, 300)}; status=${item.status}` }
  }
  if (item.type === 'tool') {
    return { itemId: item.id, text: `tool: ${clip(item.label, 200)}; status=${item.status}` }
  }
  if (item.type === 'fileChange') {
    return { itemId: item.id, text: `fileChange; status=${item.status}` }
  }
  return null
}

function mergeAssistant(
  turn: ConversationSpineTurn,
  item: Extract<ChatTranscriptItem, { type: 'assistant' }>,
  finalTurns: Set<string>,
  turnKey: string
): void {
  if (finalTurns.has(turnKey) && item.phase !== 'final_answer') return
  if (item.phase === 'final_answer') finalTurns.add(turnKey)
  const text = item.text.trim()
  if (!text) return
  const next = { itemId: item.id, text }
  if (!turn.assistant) {
    turn.assistant = next
    return
  }
  if (item.phase === 'final_answer' || turn.assistant.text !== text) {
    turn.assistant = next
  }
}

/** User messages plus one assistant answer per turn, with plan and evidence grouped per turn. */
export function conversationSpineTurns(items: ChatTranscriptItem[]): ConversationSpineTurn[] {
  const turns: ConversationSpineTurn[] = []
  let current: ConversationSpineTurn | null = null
  const finalTurns = new Set<string>()
  for (const item of items) {
    if (item.type === 'user') {
      if (current) turns.push(current)
      const attachments = item.attachments?.map((attachment) => attachment.name) ?? []
      const userText = [stripContextBlocks(item.text.trim()), attachments.length ? `[attached: ${attachments.join(', ')}]` : '']
        .filter(Boolean).join(' ')
      if (!userText) {
        current = null
        continue
      }
      current = { userItemId: item.id, userText, evidence: [] }
      continue
    }
    if (!current) continue
    const turnKey = item.turnId ?? current.userItemId
    if (item.type === 'assistant') mergeAssistant(current, item, finalTurns, turnKey)
    else if (item.type === 'plan' && item.text.trim()) {
      current.plan = { itemId: item.id, text: item.text.trim() }
    } else {
      const evidence = compactSpineEvidenceLine(item)
      if (evidence) current.evidence.push(evidence)
    }
  }
  if (current) turns.push(current)
  return turns
}

export function conversationSpineEntriesFromTurns(turns: ConversationSpineTurn[]): ConversationSpineEntry[] {
  const entries: ConversationSpineEntry[] = []
  for (const turn of turns) {
    entries.push({ id: turn.userItemId, speaker: 'User', text: turn.userText })
    if (turn.assistant) entries.push({ id: turn.assistant.itemId, speaker: 'Assistant', text: turn.assistant.text })
  }
  return entries
}

/** Rebuild turn groups from indexed spine lines (user-led grouping). */
export function conversationSpineTurnsFromIndexLines(lines: readonly ChatIndexLine[]): ConversationSpineTurn[] {
  const turns: ConversationSpineTurn[] = []
  let current: ConversationSpineTurn | null = null
  for (const line of lines) {
    if (line.role === 'user') {
      if (current) turns.push(current)
      current = { userItemId: line.itemId, userText: line.text, evidence: [] }
      continue
    }
    if (!current) continue
    if (line.role === 'assistant') current.assistant = { itemId: line.itemId, text: line.text }
    else if (line.role === 'plan') current.plan = { itemId: line.itemId, text: line.text }
    else if (line.role === 'evidence') current.evidence.push({ itemId: line.itemId, text: line.text })
  }
  if (current) turns.push(current)
  return turns
}
