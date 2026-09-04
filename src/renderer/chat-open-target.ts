import type { ChatSnapshot } from '../shared/chat.js'

/**
 * Where a thread opened from History lands. Opening one used to replace whatever the selected pane
 * was showing, so reading an old chat lost the current one and orphaned it in History. Only a pane
 * with nothing in it — no thread, no items, no turn — takes the thread in place; every other pane
 * keeps its conversation and the thread opens beside it.
 */
export function threadOpensInPlace(selected: Pick<ChatSnapshot, 'threadId' | 'items' | 'activeTurnId'>): boolean {
  return selected.threadId === null && selected.items.length === 0 && selected.activeTurnId === null
}
