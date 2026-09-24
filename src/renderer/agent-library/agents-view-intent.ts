/** One-shot navigation when opening the Agents view from the composer menu. */
export const AGENTS_VIEW_INTENT_KEY = 'closedai.agents.viewIntent'

export type AgentsViewIntent = { screen: 'build-new' }

export function queueAgentsViewIntent(intent: AgentsViewIntent): void {
  sessionStorage.setItem(AGENTS_VIEW_INTENT_KEY, JSON.stringify(intent))
}

export function takeAgentsViewIntent(): AgentsViewIntent | null {
  const raw = sessionStorage.getItem(AGENTS_VIEW_INTENT_KEY)
  if (!raw) return null
  sessionStorage.removeItem(AGENTS_VIEW_INTENT_KEY)
  try {
    const intent = JSON.parse(raw) as AgentsViewIntent
    return intent.screen === 'build-new' ? intent : null
  } catch {
    return null
  }
}
