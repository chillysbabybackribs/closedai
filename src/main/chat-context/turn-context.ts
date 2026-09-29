export type ActiveBrowserContext = {
  tabId: string
  url: string
  title: string
  isLoading: boolean
}

/**
 * A notepad window's chat: the note the user is looking at and the window's other tabs. Unlike the
 * browser tab this is the subject of every message, so it is attached on every turn.
 */
export type NotepadTurnContext = {
  surface: 'notepad'
  activeNote: { id: string; title: string; lines: number; revision: number; text: string; truncated?: string } | null
  otherTabs: Array<{ id: string; title: string; lines: number }>
}

/** What a pane is working over: the browser's active tab, or its notepad window. */
export type TurnSurfaceContext = ActiveBrowserContext | NotepadTurnContext

export type AdditionalContext = Record<string, {
  kind: 'application' | 'untrusted'
  value: string
}>

const ACTIVE_BROWSER_CONTEXT = 'closedai.browser.active-tab'
const NOTEPAD_CONTEXT = 'closedai.notepad'
export const CLOCK_CONTEXT = 'closedai.clock'
const CONTEXT_ENVELOPE_TAG = /<(\/?)closedai_context\b/gi

/**
 * A fragment's value is transcript text, and this repository's own markup turns up inside it as
 * soon as a chat quotes a page about prompt injection or discusses context blocks at all. Left
 * alone, a `</closedai_context>` in a carried-forward digest closes the envelope early and every
 * later line of that digest — the model's own prior words — reads as top-level instruction rather
 * than as untrusted data. Only the app opens and closes a block.
 */
export function escapeContextEnvelope(value: string): string {
  return value.replace(CONTEXT_ENVELOPE_TAG, '&lt;$1closedai_context')
}

/** The one tagged-text form of a fragment, for CLI lanes that cannot pass structured context. */
export function contextBlockText(name: string, fragment: AdditionalContext[string]): string {
  return `<closedai_context name="${name}" kind="${fragment.kind}">\n${escapeContextEnvelope(fragment.value)}\n</closedai_context>`
}

// Deliberately conservative: ordinary coding turns should not pay for unrelated browser
// state. These phrases indicate either browser intent or a reference to visible page state.
const BROWSER_CONTEXT_CUES = [
  /\b(?:browser|webpage|website|url|link)\b/i,
  /\b(?:browse|navigate|visit|open)\b.{0,24}\b(?:page|site|url|link|tab)\b/i,
  /\b(?:this|that|current|active|open)\s+(?:page|site|tab)\b/i,
  /\b(?:on|from)\s+(?:the\s+)?(?:page|site|screen)\b/i,
  /\bwhat\s+(?:am\s+i|are\s+we)\s+(?:looking at|viewing)\b/i
] as const

export function needsActiveBrowserContext(text: string): boolean {
  return BROWSER_CONTEXT_CUES.some((cue) => cue.test(text))
}

/** Authoritative calendar time for the host running ClosedAI; attached every user turn. */
export function buildClockAdditionalContext(now = new Date()): AdditionalContext {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const localDate = now.toLocaleDateString('en-US', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const localDateTime = now.toLocaleString('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' })
  return {
    [CLOCK_CONTEXT]: {
      kind: 'application',
      value: JSON.stringify({
        calendarDate: localDate,
        localDateTime,
        isoUtc: now.toISOString(),
        timeZone
      })
    }
  }
}

/** Build an ephemeral app-server context fragment without altering the user's message. */
export function buildTurnAdditionalContext(
  text: string,
  surface: TurnSurfaceContext | null,
  capturedAt = new Date().toISOString()
): AdditionalContext | undefined {
  if (surface && 'surface' in surface) {
    return { [NOTEPAD_CONTEXT]: { kind: 'untrusted', value: JSON.stringify({ ...surface, contextRole: 'subject', capturedAt }) } }
  }
  const activeBrowser = surface
  if (!activeBrowser || !needsActiveBrowserContext(text)) return undefined
  return {
    [ACTIVE_BROWSER_CONTEXT]: {
      kind: 'untrusted',
      value: JSON.stringify({
        surface: 'browser',
        contextRole: 'ambient',
        relevance: 'undetermined',
        capturedAt,
        ...activeBrowser
      })
    }
  }
}

/** Merge multiple optional context records into a single undefined-or-populated record. */
export function mergeTurnAdditionalContext(
  ...contexts: Array<AdditionalContext | undefined>
): AdditionalContext | undefined {
  const merged: AdditionalContext = {}
  for (const ctx of contexts) {
    if (ctx) Object.assign(merged, ctx)
  }
  return Object.keys(merged).length ? merged : undefined
}
