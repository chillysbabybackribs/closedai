import type { ChatModel } from '../../shared/chat.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { ProjectCanvasFixture } from './project-canvas-fixture.js'
import { hydrateFromSnapshot, shouldHydrateFromSnapshot, type PersistedProjectHydration } from './hydrate-project-snapshot.js'

export const PROJECT_WORKSPACE_MAP = { kind: 'map' as const }
export const PROJECT_WORKSPACE_CLOCK_MS = 15_000

export const PROJECT_WORKSPACE_MODELS: ChatModel[] = [
  { id: 'gpt-5.6', provider: 'codex', displayName: 'GPT-5.6', description: 'OpenAI through Codex', contextWindow: 400_000,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }], isDefault: true },
  { id: 'claude-fable-5-1', provider: 'claude', displayName: 'Claude Fable 5.1', description: 'Anthropic through Claude Code', contextWindow: 200_000,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }], isDefault: false },
  { id: 'cursor-composer', provider: 'cursor', displayName: 'Composer', description: 'Cursor coding model', contextWindow: 200_000,
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }], isDefault: false },
  { id: 'antigravity-gemini', provider: 'antigravity', displayName: 'Gemini', description: 'Google through Antigravity', contextWindow: 200_000,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep reasoning' }], isDefault: false }
]

export const projectWorkspaceWait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export function projectWorkspaceInitialHydration(
  canvasFixture: ProjectCanvasFixture | null,
  persistedSnapshot: ProjectSnapshot | null | undefined
): PersistedProjectHydration | null {
  if (canvasFixture) {
    return {
      discovery: canvasFixture.discovery,
      phase: 'canvas',
      tree: canvasFixture.tree,
      journal: canvasFixture.journal,
      confirmedAt: canvasFixture.confirmedAt,
      caughtUpAt: canvasFixture.caughtUpAt,
      acceptedAt: null,
      skipSimulatedDispatch: true
    }
  }
  if (persistedSnapshot && shouldHydrateFromSnapshot(persistedSnapshot)) return hydrateFromSnapshot(persistedSnapshot)
  return null
}
