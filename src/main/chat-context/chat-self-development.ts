import { sameProjectPath } from '../../shared/project-paths.js'
import { appCheckoutPathOrNull } from '../app-checkout.js'
import type { TurnSurfaceContext } from './turn-context.js'
import type { ToolSliceTurnInput } from '../tools/tool-slice-select.js'

/** True when this chat's project folder is the ClosedAI host app checkout. */
export function chatSelfDevelopment(chatProjectPath: string): boolean {
  const appCheckoutPath = appCheckoutPathOrNull()
  return appCheckoutPath ? sameProjectPath(chatProjectPath, appCheckoutPath) : false
}

export function toolSliceTurnInput(
  prompt: string | null,
  surface: TurnSurfaceContext | null,
  chatProjectPath: string
): ToolSliceTurnInput {
  return {
    prompt,
    surface,
    selfDevelopment: chatSelfDevelopment(chatProjectPath)
  }
}
