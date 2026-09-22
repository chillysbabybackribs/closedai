import type { ChatTranscriptItem } from '../shared/chat.js'

export type CaptureSurface = 'app_window' | 'agent_workspace' | 'browser_page' | 'crop'

const MAX_DETAIL_CHARS = 4_000

export function captureSurface(action: unknown): CaptureSurface | null {
  return action === 'app_window' || action === 'agent_workspace' || action === 'browser_page' || action === 'crop' ? action : null
}

export function jsonPreview(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return ''
  try {
    return clip(JSON.stringify(value, null, 2), MAX_DETAIL_CHARS)
  } catch {
    return String(value)
  }
}

/** In-progress ClosedAI registry tool row shared by Claude, Cursor, and Antigravity adapters. */
export function closedAiToolItem(
  id: string,
  turnId: string | null,
  namespace: string,
  tool: string,
  args: Record<string, unknown>
): Extract<ChatTranscriptItem, { type: 'tool' }> {
  return {
    type: 'tool',
    id,
    turnId,
    label: `${namespace} · ${tool}`,
    detail: Object.keys(args).length ? jsonPreview(args) : '',
    status: 'inProgress'
  }
}

/** What a transcript row keeps in place of a result that must never enter a record. */
export const WITHHELD_TOOL_OUTPUT = '[credential values withheld from the record]'

// Tools whose successful result the registry marks `sensitive`. The registry strips that flag
// before a provider sees the result, and the providers echo results back by tool name, so the
// transcript recognizes the tool rather than the flag. The model still receives the real content;
// only the row that the transcript cache, the Antigravity transcript copy, and the trace's item
// events would persist carries the placeholder.
const WITHHELD_RESULT_TOOLS = new Set(['credential_vault.read'])

/** True when a successful result of this ClosedAI tool is secret material. */
export function toolResultWithheld(namespace: string, tool: string): boolean {
  return WITHHELD_RESULT_TOOLS.has(`${namespace}.${tool}`)
}

/** The output a settled `namespace · tool` row may keep: the placeholder for a withheld result. */
export function recordableToolOutput(label: string, output: string, failed: boolean): string {
  if (failed || !output) return output
  const [namespace, tool] = label.split(' · ')
  return namespace && tool && toolResultWithheld(namespace, tool) ? WITHHELD_TOOL_OUTPUT : output
}

export type PromoteCaptureInput = {
  itemId: string
  turnId: string | null
  failed: boolean
  namespace: string
  tool: string
  action: unknown
  caption: string
  imageUrl: string | null | undefined
}

/** Turn a settled closedai_ui.capture tool row into a screenshot item when evidence exists. */
export function promoteCaptureToScreenshot(input: PromoteCaptureInput): Extract<ChatTranscriptItem, { type: 'screenshot' }> | null {
  if (input.failed || input.namespace !== 'closedai_ui' || input.tool !== 'capture') return null
  const surface = captureSurface(input.action)
  if (!surface || !input.imageUrl) return null
  return {
    type: 'screenshot',
    id: input.itemId,
    turnId: input.turnId,
    imageUrl: input.imageUrl,
    surface,
    caption: input.caption.split('\n')[0]?.trim() ?? ''
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
