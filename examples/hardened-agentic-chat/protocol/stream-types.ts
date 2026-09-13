/**
 * Protocol event types for hardened agentic streaming text.
 * Represents every lifecycle state of a streaming AI agent response.
 */

export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id: string; argsDelta: string }
  | { type: 'tool-call-end'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; result: unknown }
  | { type: 'error'; code: string; message: string; fatal?: boolean }
  | { type: 'heartbeat'; timestamp: number }
  | { type: 'done'; stopReason?: string; usage?: { promptTokens: number; completionTokens: number } }

/**
 * Format a typed stream event into an SSE formatted string block.
 */
export function formatSSEEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Format an SSE comment heartbeat (keeps proxies and cloud middleboxes alive).
 */
export function formatSSEComment(comment = 'ping'): string {
  return `: ${comment}\n\n`
}
