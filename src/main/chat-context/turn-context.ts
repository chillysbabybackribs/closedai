export type ActiveBrowserContext = {
  tabId: string
  url: string
  title: string
  isLoading: boolean
}

export type AdditionalContext = Record<string, {
  kind: 'application' | 'untrusted'
  value: string
}>

const ACTIVE_BROWSER_CONTEXT = 'closedai.browser.active-tab'

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

/** Build an ephemeral app-server context fragment without altering the user's message. */
export function buildTurnAdditionalContext(
  text: string,
  activeBrowser: ActiveBrowserContext | null,
  capturedAt = new Date().toISOString()
): AdditionalContext | undefined {
  if (!activeBrowser || !needsActiveBrowserContext(text)) return undefined
  return {
    [ACTIVE_BROWSER_CONTEXT]: {
      kind: 'untrusted',
      value: JSON.stringify({
        surface: 'browser',
        capturedAt,
        ...activeBrowser
      })
    }
  }
}
