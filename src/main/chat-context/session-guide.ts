import { providerTurnProfile, type ProviderTurnProfile } from '../../shared/provider-turn-profile.js'
import { AGENT_GUIDE_TEXT } from './agent-guide.generated.js'
import { handoffAdditionalContext } from './thread-handoff.js'
import { buildRuntimeAdditionalContext, type TurnRuntimeFacts } from './runtime-context.js'
import { buildClockAdditionalContext, mergeTurnAdditionalContext, type AdditionalContext } from './turn-context.js'
import { buildResearchRoutingAdditionalContext } from './research-routing.js'

export type { ProviderTurnProfile } from '../../shared/provider-turn-profile.js'
export { providerTurnProfile } from '../../shared/provider-turn-profile.js'

export const SESSION_GUIDE_CONTEXT = 'closedai.guide'
export const SESSION_GUIDE_MAX_CHARS = 9_000

/** Per-pane delivery memory; thread ids rotate on handoff and tool-catalog refresh. */
export type SessionGuideDeliveryState = {
  lastDeliveredThreadKey: string | null
}

export function agentGuideAdditionalContext(): AdditionalContext {
  if (AGENT_GUIDE_TEXT.length > SESSION_GUIDE_MAX_CHARS) {
    throw new Error(`Session guide exceeds ${SESSION_GUIDE_MAX_CHARS} characters`)
  }
  return {
    [SESSION_GUIDE_CONTEXT]: {
      kind: 'application',
      value: AGENT_GUIDE_TEXT
    }
  }
}

/** Stable key for whether this provider thread already received the guide. */
export function sessionGuideThreadKey(
  persistedThreadId: string | null,
  liveThreadId: string | null,
  paneId: string
): string {
  return persistedThreadId ?? liveThreadId ?? `unsaved:${paneId}`
}

export function shouldAttachSessionGuide(input: {
  threadKey: string
  state: SessionGuideDeliveryState
  transcriptWasEmpty: boolean
  hasHandoff: boolean
}): boolean {
  const { threadKey, state, transcriptWasEmpty, hasHandoff } = input
  const delivered = state.lastDeliveredThreadKey
  if (delivered === threadKey) return false
  if (delivered?.startsWith('unsaved:') && !threadKey.startsWith('unsaved:')) return false
  if (hasHandoff) return true
  return transcriptWasEmpty
}

export function buildTurnSendContext(input: {
  prompt: string
  threadKey: string
  state: SessionGuideDeliveryState
  transcriptWasEmpty: boolean
  pendingHandoff: string | null
  runtime: TurnRuntimeFacts
  workspaceLedgerContext?: AdditionalContext | undefined
  browserContext: AdditionalContext | undefined
  /** Defaults from `providerTurnProfile(runtime.provider)`; override for tests or future settings. */
  profile?: ProviderTurnProfile
}): { context: AdditionalContext | undefined; attachGuide: boolean } {
  const profile = input.profile ?? providerTurnProfile(input.runtime.provider, input.runtime)
  const attachGuide = profile.sessionGuide && shouldAttachSessionGuide({
    threadKey: input.threadKey,
    state: input.state,
    transcriptWasEmpty: input.transcriptWasEmpty,
    hasHandoff: Boolean(input.pendingHandoff)
  })
  const context = mergeTurnAdditionalContext(
    buildClockAdditionalContext(),
    buildRuntimeAdditionalContext({ ...input.runtime, sessionGuideOnTurn: attachGuide }),
    profile.researchRouting ? buildResearchRoutingAdditionalContext(input.prompt) : undefined,
    attachGuide ? agentGuideAdditionalContext() : undefined,
    input.pendingHandoff ? handoffAdditionalContext(input.pendingHandoff) : undefined,
    profile.workspaceLedger ? input.workspaceLedgerContext : undefined,
    input.browserContext
  )
  return { context, attachGuide }
}

export function markSessionGuideDelivered(state: SessionGuideDeliveryState, threadKey: string): void {
  const prior = state.lastDeliveredThreadKey
  if (prior?.startsWith('unsaved:') && !threadKey.startsWith('unsaved:')) {
    state.lastDeliveredThreadKey = threadKey
    return
  }
  state.lastDeliveredThreadKey = threadKey
}
