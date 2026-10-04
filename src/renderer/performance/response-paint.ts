import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'

/** Only live, visible panes participate; replay, hidden panes and whitespace are excluded. */
export class ResponsePaintTracker {
  private readonly active = new Map<string, string>()
  private readonly items = new Map<string, string>()
  private readonly receipts = new Map<string, number>()
  private readonly observed = new Set<string>()

  constructor(private readonly now: () => number = () => performance.now()) {}

  observe(event: ChatWorkspaceEvent, visible: (paneId: string) => boolean): void {
    if (event.type !== 'pane') return
    const { paneId, event: update } = event
    if (update.type === 'turn') {
      if (update.turnId) this.active.set(paneId, update.turnId)
      else this.active.delete(paneId)
      return
    }
    const turn = this.active.get(paneId)
    if (!turn) return
    let text = ''
    if (update.type === 'item' && update.item.type === 'assistant' && update.item.turnId === turn) {
      this.items.set(`${paneId}:${update.item.id}`, turn)
      text = update.item.text
      if (this.items.size > 400) this.items.delete(this.items.keys().next().value!)
    } else if (update.type === 'itemDelta' && update.field === 'text' && this.items.get(`${paneId}:${update.itemId}`) === turn) {
      text = update.delta
    }
    const key = `${paneId}:${turn}`
    if (!text.trim() || this.observed.has(key)) return
    this.observed.add(key)
    if (visible(paneId)) this.receipts.set(key, this.now())
    if (this.observed.size > 200) {
      const oldest = this.observed.values().next().value!
      this.observed.delete(oldest)
      this.receipts.delete(oldest)
    }
  }

  take(paneId: string, turnId: string): number | null {
    const key = `${paneId}:${turnId}`
    const receipt = this.receipts.get(key)
    this.receipts.delete(key)
    return receipt === undefined ? null : Math.max(0, this.now() - receipt)
  }
}

export const responsePaintTracker = new ResponsePaintTracker()
const panes = new Map<string, () => boolean>()
export function registerResponsePane(id: string, visible: () => boolean): () => void {
  panes.set(id, visible)
  return () => { if (panes.get(id) === visible) panes.delete(id) }
}
export function observeResponsePaint(event: ChatWorkspaceEvent): void {
  responsePaintTracker.observe(event, (id) => document.visibilityState === 'visible' && panes.get(id)?.() === true)
}
export function elementVisible(element: HTMLElement | null): boolean {
  if (!element || !element.getClientRects().length) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth
}
