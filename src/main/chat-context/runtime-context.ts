import type { ChatProvider } from '../../shared/chat.js'
import { sameProjectPath } from '../../shared/project-paths.js'
import { appCheckoutPathOrNull } from '../app-checkout.js'
import type { AdditionalContext } from './turn-context.js'

export const RUNTIME_CONTEXT = 'closedai.runtime'

export const DEVELOPMENT_FIRST_READ =
  'For a repository development task: read docs/application.md under appCheckoutPath when working on this ClosedAI host application; read docs/application.md (or the project\'s own instructions) under chatProjectPath when working in another folder. When appCheckoutPath and chatProjectPath differ, the chat folder is not the host app — do not conflate them. Read opening guidance and task-relevant sections before implementation searches or edits; do not load entire guides unnecessarily. This does not apply to unrelated chat, web research, or browser tasks.'

export const USER_COLLABORATION =
  'User questions and ideas are hypotheses, not build orders. Prefer a short list of options with a recommendation; implement or change code only after explicit direction. When unsure about product behavior, provider capability, or external facts, validate with docs, repo reads, tools, or a targeted search—not memory alone.'

export type TurnRuntimeFacts = {
  paneId: string | null
  provider: ChatProvider
  cwd: string
  chatMemoryIndexEnabled: boolean
  /** Whether closedai.guide is attached on this send (Codex/Claude/Antigravity only). */
  sessionGuideOnTurn: boolean
  chatCursorBaselineEnabled?: boolean
}

/** Host facts and shared development orientation for every provider turn. */
export function buildRuntimeAdditionalContext(facts: TurnRuntimeFacts): AdditionalContext {
  const appCheckoutPath = appCheckoutPathOrNull()
  const chatProjectPath = facts.cwd
  const selfDevelopment = appCheckoutPath ? sameProjectPath(chatProjectPath, appCheckoutPath) : false
  return {
    [RUNTIME_CONTEXT]: {
      kind: 'application',
      value: JSON.stringify({
        host: 'closedai',
        paneId: facts.paneId,
        provider: facts.provider,
        appCheckoutPath,
        chatProjectPath,
        /** @deprecated Use chatProjectPath; kept for older prompts and tools. */
        projectPath: chatProjectPath,
        selfDevelopment,
        chatMemoryIndexEnabled: facts.chatMemoryIndexEnabled,
        sessionGuideOnTurn: facts.sessionGuideOnTurn,
        cursorBaselineEnabled: facts.chatCursorBaselineEnabled === true,
        developmentFirstRead: DEVELOPMENT_FIRST_READ,
        userCollaboration: USER_COLLABORATION,
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
  chatCursorBaselineEnabled?: boolean
}): TurnRuntimeFacts {
  return input
}
