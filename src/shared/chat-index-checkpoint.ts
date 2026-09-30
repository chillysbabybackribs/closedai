import type { ChatMemoryCheckpoint, ChatMemoryState } from './chat-memory.js'

/** Synthetic recall/search ids for indexed checkpoint facets (not transcript item ids). */
export const CHECKPOINT_INDEX_PREFIX = 'cp.'

const LIST_FIELDS: Array<{ key: keyof Pick<ChatMemoryState, 'constraints' | 'decisions' | 'progress' | 'nextSteps' | 'files'>; label: string }> = [
  { key: 'constraints', label: 'Constraint' },
  { key: 'decisions', label: 'Decision' },
  { key: 'progress', label: 'Progress' },
  { key: 'nextSteps', label: 'Next step' },
  { key: 'files', label: 'File' }
]

export function checkpointIndexItemId(throughItemId: string, facet: string): string {
  const id = `${CHECKPOINT_INDEX_PREFIX}${throughItemId}.${facet}`
  if (id.length > 256) throw new Error('Checkpoint index id exceeds recall limit')
  return id
}

export function isCheckpointIndexItemId(itemId: string): boolean {
  return itemId.startsWith(CHECKPOINT_INDEX_PREFIX)
}

export function checkpointTextForItemId(checkpoint: ChatMemoryCheckpoint, itemId: string): string | null {
  if (!itemId.startsWith(CHECKPOINT_INDEX_PREFIX)) return null
  const rest = itemId.slice(CHECKPOINT_INDEX_PREFIX.length)
  const dot = rest.indexOf('.')
  if (dot < 0) return null
  const throughItemId = rest.slice(0, dot)
  const facet = rest.slice(dot + 1)
  if (throughItemId !== checkpoint.throughItemId) return null
  const memory = checkpoint.state
  if (facet === 'goal') return memory.goal
  for (const { key, label } of LIST_FIELDS) {
    if (facet.startsWith(`${key}.`)) {
      const index = Number(facet.slice(key.length + 1))
      const entry = memory[key][index]
      return entry ? `${label}: ${entry}` : null
    }
  }
  return null
}

/** Turn-shaped index lines for pane lexical search (model-authored, may be stale). */
export function chatIndexLinesFromCheckpoint(checkpoint: ChatMemoryCheckpoint): Array<{ itemId: string; role: 'checkpoint'; text: string }> {
  const anchor = checkpoint.throughItemId
  const lines: Array<{ itemId: string; role: 'checkpoint'; text: string }> = [
    { itemId: checkpointIndexItemId(anchor, 'goal'), role: 'checkpoint', text: `Goal: ${checkpoint.state.goal}` }
  ]
  for (const { key, label } of LIST_FIELDS) {
    checkpoint.state[key].forEach((entry, index) => {
      lines.push({
        itemId: checkpointIndexItemId(anchor, `${key}.${index}`),
        role: 'checkpoint',
        text: `${label}: ${entry}`
      })
    })
  }
  return lines
}
