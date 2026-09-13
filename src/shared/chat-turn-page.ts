import type { ChatTranscriptItem } from './chat.js'

export type TurnSlice = {
  start: number
  end: number
  hasEarlier: boolean
}

/** Index of the user message that starts the last turn in `[0, end)`. */
export function lastTurnStartIndex(items: readonly ChatTranscriptItem[], end = items.length): number {
  for (let index = end - 1; index >= 0; index -= 1) {
    if (items[index]?.type === 'user') return index
  }
  return 0
}

/** Up to `turns` complete turns ending at `endExclusive`, oldest first. */
export function turnsBeforeIndex(
  items: readonly ChatTranscriptItem[],
  endExclusive: number,
  turns: number
): TurnSlice {
  if (turns <= 0 || endExclusive <= 0) return { start: endExclusive, end: endExclusive, hasEarlier: false }
  let cursor = endExclusive
  let start = endExclusive
  for (let loaded = 0; loaded < turns && cursor > 0; loaded += 1) {
    const turnStart = lastTurnStartIndex(items, cursor)
    start = turnStart
    cursor = turnStart
  }
  return { start, end: endExclusive, hasEarlier: start > 0 }
}

/** The last `turns` turns in `items`. */
export function tailTurnSlice(items: readonly ChatTranscriptItem[], turns: number): TurnSlice {
  return turnsBeforeIndex(items, items.length, turns)
}
