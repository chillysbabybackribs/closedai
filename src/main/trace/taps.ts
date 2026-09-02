import type { ChatProvider } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { ToolCallTrace, ToolRegistry } from '../tools/registry.js'
import { summarizeItem } from './summaries.js'
import { formatDuration, providerOfTurn, traceLog } from './trace-log.js'

// The two taps that are not provider-specific: registry tool calls (every provider's tools go
// through the one registry) and the normalized chat event stream the renderer receives.

/** Record every registry call with its full arguments and result. */
export function traceToolCalls(registry: ToolRegistry): () => void {
  return registry.observe((call: ToolCallTrace) => {
    const { context, request } = call
    const scope = { paneId: context.paneId ?? null, provider: providerOfTurn(context.turnId), turnId: context.turnId }
    const name = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
    const args = request.arguments
    const action = args && typeof args === 'object' && typeof (args as { action?: unknown }).action === 'string'
      ? `.${String((args as { action: string }).action)}` : ''
    const nested = context.parentCallId ? ` (in ${context.parentCallId})` : ''
    if (call.phase === 'start') {
      traceLog.record(scope, {
        kind: 'tool',
        label: 'tool.call',
        summary: `${name}${action} · ${context.callId}${nested}`,
        detail: { callId: context.callId, parentCallId: context.parentCallId ?? null, batchId: context.batchId ?? null, source: context.source ?? 'model', arguments: args ?? {} }
      })
      return
    }
    const ok = !call.result.isError
    traceLog.record(scope, {
      kind: 'tool',
      label: 'tool.result',
      summary: `${name}${action} · ${ok ? 'ok' : 'failed'} in ${formatDuration(call.durationMs)}`,
      detail: { callId: context.callId, isError: call.result.isError ?? false, content: compactContent(call.result.content) },
      durationMs: call.durationMs,
      ok
    })
  })
}

const lastProviderByPane = new Map<string, ChatProvider>()

/** Record turn boundaries, transcript items, and context updates as the panes receive them. */
export function traceChatEvent(event: ChatWorkspaceEvent): void {
  if (event.type !== 'pane') return
  const { paneId } = event
  const inner = event.event
  switch (inner.type) {
    case 'turn': {
      const provider = providerOfTurn(inner.turnId) ?? lastProviderByPane.get(paneId) ?? null
      if (provider) lastProviderByPane.set(paneId, provider)
      traceLog.noteTurn(paneId, provider, inner.turnId)
      return
    }
    case 'item': {
      const item = inner.item
      const provider = providerOfTurn(item.turnId) ?? lastProviderByPane.get(paneId) ?? null
      traceLog.record({ paneId, provider, turnId: item.turnId }, {
        kind: 'event',
        label: `item.${item.type}`,
        summary: summarizeItem(item),
        detail: item.type === 'screenshot' ? { ...item, imageUrl: `<${item.imageUrl.length} chars>` } : item,
        ...(item.type === 'notice' ? { ok: item.tone !== 'error' } : {})
      })
      return
    }
    case 'context': {
      const usage = inner.usage
      traceLog.record({ paneId, provider: lastProviderByPane.get(paneId) ?? null, turnId: null }, {
        kind: 'event',
        label: 'context',
        summary: usage ? `${usage.percent}% of ${usage.contextWindow.toLocaleString()} tokens used` : 'context usage unknown',
        detail: usage
      })
      return
    }
    case 'thread': {
      traceLog.record({ paneId, provider: lastProviderByPane.get(paneId) ?? null, turnId: null }, {
        kind: 'event',
        label: 'thread',
        summary: inner.threadId ? `thread ${inner.threadId}${inner.threadName ? ` · ${inner.threadName}` : ''}` : 'thread cleared',
        detail: { threadId: inner.threadId, threadName: inner.threadName }
      })
      return
    }
    default:
      return
  }
}

/** Keep binary payloads out of the detail: an image becomes its size. */
function compactContent(content: unknown[]): unknown[] {
  return content.map((part) => {
    if (!part || typeof part !== 'object') return part
    const record = part as Record<string, unknown>
    if (typeof record.data === 'string' && record.data.length > 256) return { ...record, data: `<${record.data.length} chars>` }
    return part
  })
}
