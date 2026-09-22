import type { ChatPaneId } from '../../shared/chat-peers.js'

/** Send to a background peer and wait until its turn completes. */
export function sendAndWaitForPaneTurn(paneId: ChatPaneId, text: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawTurn = false
    let sawAssistant = false
    let settled = false
    const timer = window.setTimeout(() => finish(new Error('Timed out waiting for the project model')), timeoutMs)
    const unsubscribe = window.closedai.chat.onEvent((event) => {
      if (event.type !== 'pane' || event.paneId !== paneId) return
      if (event.event.type === 'turn') {
        if (event.event.turnId) sawTurn = true
        else if (sawTurn || sawAssistant) finish()
      }
      if (event.event.type === 'item' && event.event.item.type === 'assistant') {
        sawAssistant = true
        if (!event.event.item.streaming) finish()
      }
      if (event.event.type === 'item' && event.event.item.type === 'notice' && event.event.item.tone === 'error') {
        finish(new Error(event.event.item.text))
      }
    })
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      unsubscribe()
      if (error) reject(error)
      else resolve()
    }
    void window.closedai.chat.send(paneId, text, []).catch((reason: unknown) =>
      finish(reason instanceof Error ? reason : new Error(String(reason))))
  })
}
