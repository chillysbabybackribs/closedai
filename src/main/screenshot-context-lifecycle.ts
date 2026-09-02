import type { AppServerNotification } from './app-server-client.js'
import { recordOf, stringOf } from './chat-normalizers.js'
import type { CompletedToolCall } from './tools/app-server-tools.js'

/** Tracks turns that consumed capture pixels and requests exactly one post-turn compaction. */
export class ScreenshotContextLifecycle {
  private readonly pendingTurns = new Map<string, string>()

  observe(call: CompletedToolCall): void {
    if (call.request.namespace !== 'closedai_ui' || call.request.tool !== 'capture') return
    const args = recordOf(call.request.arguments)
    if (args?.action !== 'app_window' && args?.action !== 'browser_page') return
    if (call.result.isError || !call.result.content.some((item) => item.type === 'image')) return
    const { threadId, turnId } = call.context
    if (threadId && turnId) this.pendingTurns.set(turnId, threadId)
  }

  /** Return the owning thread once; repeated completion notifications are harmless. */
  consumeCompleted(notification: AppServerNotification): { threadId: string; turnId: string } | null {
    if (notification.method !== 'turn/completed') return null
    const params = recordOf(notification.params)
    const turnId = stringOf(recordOf(params?.turn)?.id)
    const threadId = this.pendingTurns.get(turnId)
    if (!threadId) return null
    this.pendingTurns.delete(turnId)
    return { threadId, turnId }
  }

  clear(): void {
    this.pendingTurns.clear()
  }
}
