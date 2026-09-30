import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import { PROVIDER_LABELS } from './chat-state.js'

// Pure state for the composer's model menu: what the trigger reads and how the menu groups.

export type ModelGroup = { provider: ChatProvider; label: string; models: ChatModel[] }

const PROVIDER_ORDER: readonly ChatProvider[] = CHAT_PROVIDERS

/** Models grouped by provider in a fixed order; providers without models are omitted. */
export function modelGroups(models: ChatModel[]): ModelGroup[] {
  return PROVIDER_ORDER.flatMap((provider) => {
    const entries = models.filter((model) => model.provider === provider)
    return entries.length ? [{ provider, label: PROVIDER_LABELS[provider], models: entries }] : []
  })
}

/** "Low" / "Xhigh" → "Low" / "XHigh"-free plain casing the picker has always used. */
export function effortLabel(effort: string): string {
  return effort.split(/[-_]/).map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '')).join(' ')
}

/** The trigger text: the model's name, and the effort as a quiet suffix when the model has one. */
export function modelTriggerLabel(
  models: ChatModel[],
  selectedModel: string | null,
  selectedEffort: string | null
): { name: string; context: string | null; effort: string | null; description: string } {
  const model = models.find((entry) => entry.id === selectedModel)
  if (!model) return { name: models.length ? 'Choose model' : 'No models', context: null, effort: null, description: '' }
  const effort = model.supportedReasoningEfforts.find((option) => option.reasoningEffort === selectedEffort)
  return {
    name: model.displayName,
    context: modelContextLabel(model.contextWindow),
    effort: effort ? effortLabel(effort.reasoningEffort) : null,
    description: model.description
  }
}

const MENU_DETAIL_MAX = 48

/** One quiet line under a model name in the flyout: shorter than the full catalogue blurb. */
export function modelMenuDetail(model: ChatModel): string | null {
  let text = model.description.trim()
  text = stripSubscriptionBlurb(text)
  if (!text) {
    const ctx = modelContextLabel(model.contextWindow)
    return ctx ? `${ctx} context` : null
  }
  const ctx = modelContextLabel(model.contextWindow)
  if (ctx && !detailMentionsContext(text, ctx)) text = `${text} · ${ctx}`
  return truncateMenuDetail(text)
}

/** Effort rows get the same length cap without repeating the label. */
export function effortMenuDetail(description: string): string | null {
  const text = description.trim()
  return text ? truncateMenuDetail(text) : null
}

function stripSubscriptionBlurb(text: string): string {
  return text
    .replace(/\s*[—–-]\s*on your [\w\s]+subscription\.?$/i, '')
    .replace(/^on your [\w\s]+subscription\.?$/i, '')
    .trim()
}

function detailMentionsContext(text: string, ctx: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes(ctx.toLowerCase()) || /\d+\s*[km]\b/i.test(text) || lower.includes('context')
}

function truncateMenuDetail(text: string): string {
  if (text.length <= MENU_DETAIL_MAX) return text
  const cut = text.slice(0, MENU_DETAIL_MAX - 1)
  const breakAt = Math.max(cut.lastIndexOf(' · '), cut.lastIndexOf(' '))
  const head = breakAt > MENU_DETAIL_MAX * 0.45 ? cut.slice(0, breakAt) : cut
  return `${head.trimEnd()}…`
}

/** Compact, stable context labels for both the resting trigger and catalog rows. */
export function modelContextLabel(tokens: number | undefined): string | null {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return null
  // Codex's active-input maximum can reserve output space from a nominal million-token model.
  // Present that 800K–1.1M band as the product tier users recognize, as Cursor does.
  if (tokens >= 800_000 && tokens <= 1_100_000) return '1M'
  if (tokens > 1_100_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(Math.round(tokens))
}

/** A model's own blurb for its row's tooltip, without the subscription boilerplate every row shares. */
export function modelBlurb(model: ChatModel): string | null {
  return stripSubscriptionBlurb(model.description.trim()) || null
}

type Box = { left: number; right: number; width: number }

export type ModelFlyoutPlacement = {
  side: 'left' | 'right'
  align: 'start' | 'end'
  /** From the anchoring provider row; negative when a narrow pane makes the flyout overlap the panel. */
  sideOffset: number
  width: number
}

/**
 * Where a provider's model flyout opens beside the provider panel. It takes whichever side of the
 * panel has room inside the boundary (the chat pane: a DOM overlay must never reach over the
 * browser column), preferring the right; when neither side does, it slides over the panel just far
 * enough to stay inside. It grows the way the panel opened: upward from the row when the panel
 * sits above the trigger, downward when it dropped below.
 */
export function modelFlyoutPlacement(
  panel: Box,
  row: Box,
  boundary: Box,
  panelSide: string | null,
  { width = 288, gap = 6, padding = 12 }: { width?: number; gap?: number; padding?: number } = {}
): ModelFlyoutPlacement {
  const fit = Math.max(0, Math.floor(Math.min(width, boundary.width - padding * 2)))
  const roomRight = boundary.right - padding - panel.right
  const roomLeft = panel.left - boundary.left - padding
  const side = roomRight >= fit + gap || roomRight >= roomLeft ? 'right' : 'left'
  const room = side === 'right' ? roomRight : roomLeft
  const inset = side === 'right' ? panel.right - row.right : row.left - panel.left
  return {
    side,
    align: panelSide === 'bottom' ? 'start' : 'end',
    sideOffset: room >= fit + gap ? inset + gap : inset + room - fit,
    width: fit
  }
}
