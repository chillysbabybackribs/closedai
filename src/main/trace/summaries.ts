import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatTranscriptItem } from '../../shared/chat.js'

// One-line descriptions of raw provider traffic and transcript items for the trace list. These
// only pick out names and ids; the full payload rides alongside as the entry's detail.

type Rec = Record<string, unknown>

function rec(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** A Codex app-server JSON-RPC line: request, notification, or response. */
export function summarizeCodexRpc(message: unknown): string {
  const record = rec(message)
  if (!record) return 'non-object line'
  const id = record.id !== undefined ? `#${String(record.id)}` : null
  const method = str(record.method)
  if (method) {
    const params = rec(record.params)
    const item = rec(params?.item)
    const detail = str(item?.type) ?? str(params?.type) ?? str(item?.name) ?? null
    return `${method}${id ? ` ${id}` : ''}${detail ? ` · ${detail}` : ''}`
  }
  if ('error' in record) {
    const error = rec(record.error)
    return `error ${id ?? ''} ${str(error?.message) ?? ''}`.trim()
  }
  return `response ${id ?? ''}`.trim()
}

/** One Claude Agent SDK message from the CLI process. */
export function summarizeClaudeMessage(message: SDKMessage): string {
  const record = message as unknown as Rec
  const type = str(record.type) ?? 'message'
  if (type === 'stream_event') {
    const event = rec(record.event)
    const eventType = str(event?.type) ?? ''
    const block = rec(event?.content_block)
    const delta = rec(event?.delta)
    const inner = str(block?.type) ?? str(delta?.type) ?? null
    const name = str(block?.name)
    return `stream ${eventType}${inner ? ` · ${inner}` : ''}${name ? ` ${name}` : ''}`
  }
  if (type === 'assistant' || type === 'user') {
    const body = rec(record.message)
    const content = Array.isArray(body?.content) ? body.content : []
    const parts = content.map((part) => {
      const p = rec(part)
      const partType = str(p?.type) ?? 'part'
      const name = str(p?.name)
      return name ? `${partType} ${name}` : partType
    })
    const stop = str(body?.stop_reason)
    return `${type}${parts.length ? ` · ${parts.join(', ')}` : ''}${stop ? ` · stop ${stop}` : ''}`
  }
  if (type === 'result') {
    const cost = typeof record.total_cost_usd === 'number' ? ` · $${record.total_cost_usd.toFixed(4)}` : ''
    return `result ${str(record.subtype) ?? ''}${cost}`.trim()
  }
  const subtype = str(record.subtype)
  return subtype ? `${type} ${subtype}` : type
}

/** One `agy` stream-json event. */
export function summarizeAntigravityEvent(raw: unknown): string {
  const record = rec(raw)
  if (!record) return 'non-object line'
  const event = str(record.event) ?? str(record.type) ?? 'event'
  if (event === 'step_update') {
    const step = str(record.step_type) ?? ''
    const state = str(record.state) ?? ''
    const tool = rec(record.tool_info)
    const name = str(tool?.name)
    return `step ${step} ${state}${name ? ` · ${name}` : ''}`.replace(/\s+/g, ' ').trim()
  }
  if (event === 'result') return `result ${str(record.status) ?? ''}`.trim()
  if (event === 'init') return `init · ${str(record.model) ?? ''}`.trim()
  return event
}

/** A normalized transcript item as the pane received it. */
export function summarizeItem(item: ChatTranscriptItem): string {
  switch (item.type) {
    case 'user': return `user · ${item.text.slice(0, 80)}`
    case 'assistant': return `assistant${item.phase ? ` ${item.phase}` : ''}${item.streaming ? ' (streaming)' : ''} · ${item.text.length} chars`
    case 'reasoning': return `reasoning${item.streaming ? ' (streaming)' : ''} · ${item.text.length} chars`
    case 'plan': return `plan${item.streaming ? ' (streaming)' : ''}`
    case 'command': return `command ${item.status} · ${item.command.slice(0, 80)}`
    case 'fileChange': return `fileChange ${item.status} · ${item.changes.length} file(s)`
    case 'tool': return `tool ${item.status} · ${item.label}`
    case 'screenshot': return `screenshot ${item.surface}`
    case 'notice': return `notice ${item.tone} · ${item.text.slice(0, 80)}`
  }
}
