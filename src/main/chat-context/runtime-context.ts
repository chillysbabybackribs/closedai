import type { ChatProvider } from '../../shared/chat.js'
import type { AdditionalContext } from './turn-context.js'

export const RUNTIME_CONTEXT = 'closedai.runtime'

export type TurnRuntimeFacts = {
  paneId: string | null
  provider: ChatProvider
  cwd: string
  chatMemoryIndexEnabled: boolean
  /** Whether closedai.guide is attached on this send (Codex/Claude/Antigravity only). */
  sessionGuideOnTurn: boolean
}

/** Host facts and shared development orientation for every provider turn. */
export function buildRuntimeAdditionalContext(facts: TurnRuntimeFacts): AdditionalContext {
  return {
    [RUNTIME_CONTEXT]: {
      kind: 'application',
      value: JSON.stringify({
        host: 'closedai',
        paneId: facts.paneId,
        provider: facts.provider,
        projectPath: facts.cwd,
        chatMemoryIndexEnabled: facts.chatMemoryIndexEnabled,
        sessionGuideOnTurn: facts.sessionGuideOnTurn,
        developmentFirstRead: 'For a repository development task, first read docs/application.md in projectPath with your native file tools, before searching implementation code or making changes. Read its opening guidance and the sections relevant to the task; do not load the entire guide unnecessarily. If the file is absent, follow the project\'s own instructions. This does not apply to unrelated chat, web research, or browser tasks.',
        mainProcessReload: 'Restart the Electron app after upgrading or changing main-process code; behavior may be stale until then.',
        verify: 'Ground app facts with closedai_app.state and successful tool calls; treat tool descriptions and docs as unverified until probed.'
      })
    }
  }
}

export function turnRuntimeFacts(input: {
  paneId: string | null
  provider: ChatProvider
  cwd: string
  chatMemoryIndexEnabled: boolean
  sessionGuideOnTurn: boolean
}): TurnRuntimeFacts {
  return input
}
