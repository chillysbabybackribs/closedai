import type { ChatIndexLine } from '../../shared/chat-index.js'
import { chatIndexLinesFromCheckpoint } from '../../shared/chat-index-checkpoint.js'
import type { ChatMemoryCheckpoint } from '../../shared/chat-memory.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { normalizeMemoryCheckpoint } from '../chat-context/memory-checkpoint.js'
import { chatIndexLinesFromTranscript } from './chat-memory-index.js'
import type { ChatTranscriptItem } from '../../shared/chat.js'

function pushCheckpoint(lines: ChatIndexLine[], checkpoint: ChatMemoryCheckpoint | null | undefined): void {
  const normalized = checkpoint ? normalizeMemoryCheckpoint(checkpoint) : null
  if (!normalized) return
  for (const line of chatIndexLinesFromCheckpoint(normalized)) lines.push(line)
}

/** Checkpoints on the pane and frozen continuation source (when different). */
export function chatPaneCheckpointIndexLines(record: ChatRecord): ChatIndexLine[] {
  const lines: ChatIndexLine[] = []
  pushCheckpoint(lines, record.checkpoint)
  const frozen = record.continuation?.checkpoint
  if (frozen && frozen.throughItemId !== record.checkpoint?.throughItemId) pushCheckpoint(lines, frozen)
  return lines
}

/** Prefer checkpoint facets when trimming; drop oldest transcript lines first. */
export function mergePaneIndexLines(
  items: ChatTranscriptItem[],
  record: ChatRecord,
  maxChars: number
): ChatIndexLine[] {
  const checkpointLines = chatPaneCheckpointIndexLines(record)
  let used = checkpointLines.reduce((sum, line) => sum + line.text.length + 1, 0)
  const transcriptLines = chatIndexLinesFromTranscript(items, maxChars)
  const keptTranscript: ChatIndexLine[] = []
  for (let index = transcriptLines.length - 1; index >= 0; index -= 1) {
    const line = transcriptLines[index]!
    const cost = line.text.length + 1
    if (used + cost > maxChars) continue
    keptTranscript.unshift(line)
    used += cost
  }
  return [...keptTranscript, ...checkpointLines]
}
