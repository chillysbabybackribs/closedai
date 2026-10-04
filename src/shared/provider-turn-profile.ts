import type { ChatProvider } from './chat.js'

/** Which ClosedAI turn-context blocks a provider lane attaches (delivery still varies by adapter). */
export type ProviderTurnProfile = {
  /** `closedai.guide` on first provider thread and after handoff. */
  sessionGuide: boolean
  /** `closedai.workspace.ledger` when the host gate and settings allow it. */
  workspaceLedger: boolean
  /** `closedai.research.routing` when the prompt matches the research heuristic. */
  researchRouting: boolean
  /**
   * `full_mcp`: every enabled MCP namespace stays attached; task slices are telemetry only (Cursor).
   * `native_discovery`: stable registry defaults with native discovery (baseline experiment).
   * `task_slice`: eager promotion follows `scripts/tool-slices.json` (Codex, Claude, Antigravity).
   */
  toolCatalogAttach: 'full_mcp' | 'task_slice' | 'native_discovery'
}

const CURSOR_PROFILE: ProviderTurnProfile = {
  sessionGuide: false,
  workspaceLedger: false,
  researchRouting: true,
  toolCatalogAttach: 'full_mcp'
}

const DEFAULT_PROFILE: ProviderTurnProfile = {
  sessionGuide: true,
  workspaceLedger: true,
  researchRouting: true,
  toolCatalogAttach: 'task_slice'
}

/** Per-provider turn-context policy; tweak one lane without changing the others. */
export function providerTurnProfile(
  provider: ChatProvider,
  settings: { chatCursorBaselineEnabled?: boolean } = {}
): ProviderTurnProfile {
  if (provider === 'cursor') return CURSOR_PROFILE
  if (settings.chatCursorBaselineEnabled === true) {
    return { ...CURSOR_PROFILE, toolCatalogAttach: 'native_discovery' }
  }
  return DEFAULT_PROFILE
}
