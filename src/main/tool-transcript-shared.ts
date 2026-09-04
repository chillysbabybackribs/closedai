import type { ChatTranscriptItem } from '../shared/chat.js'

export type CaptureSurface = 'app_window' | 'browser_page' | 'crop'

const MAX_DETAIL_CHARS = 4_000

export function captureSurface(action: unknown): CaptureSurface | null {
  return action === 'app_window' || action === 'browser_page' || action === 'crop' ? action : null
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
