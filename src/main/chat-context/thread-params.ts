import { dynamicToolSpecs } from '../tools/app-server-tools.js'
import type { ToolRegistry } from '../tools/registry.js'

export type ThreadResponse = {
  thread?: unknown
  model?: unknown
  reasoningEffort?: unknown
}

export type ThreadModelSettings = {
  model: string | null
  effort: string | null
  contextWindow?: number
}
import { closedAiDeveloperInstructions } from './developer-instructions.js'
import { workspaceNavigationSection } from './workspace-navigation.js'

/**
 * Product guidance plus a small app-authored orientation capsule. Repository-derived
 * details stay out of trusted instructions and are available through a deferred tool.
 */
function threadInstructions(cwd: string): string {
  const instructions = closedAiDeveloperInstructions(cwd)
  const navigation = workspaceNavigationSection(cwd)
  return navigation ? `${instructions}\n\n${navigation}` : instructions
}

function sharedThreadParams(cwd: string, tools: ToolRegistry): Record<string, unknown> {
  return {
    cwd,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    developerInstructions: threadInstructions(cwd),
    ...(tools.isEmpty ? {} : { dynamicTools: dynamicToolSpecs(tools) })
  }
}

export function resumeThreadParams(
  threadId: string,
  cwd: string,
  tools: ToolRegistry,
  modelSettings: ThreadModelSettings = { model: null, effort: null }
): Record<string, unknown> {
  return {
    threadId,
    ...sharedThreadParams(cwd, tools),
    excludeTurns: false,
    ...(modelSettings.model ? { model: modelSettings.model } : {}),
    ...threadConfig(modelSettings)
  }
}

export function startThreadParams(
  cwd: string,
  tools: ToolRegistry,
  modelSettings: ThreadModelSettings = { model: null, effort: null }
): Record<string, unknown> {
  return {
    ...sharedThreadParams(cwd, tools),
    serviceName: 'closedai',
    ...(modelSettings.model ? { model: modelSettings.model } : {}),
    ...threadConfig(modelSettings)
  }
}

function threadConfig(settings: ThreadModelSettings): { config?: Record<string, unknown> } {
  const contextWindow = settings.contextWindow
  const config = {
    ...(settings.effort ? { model_reasoning_effort: settings.effort } : {}),
    ...(typeof contextWindow === 'number' && Number.isSafeInteger(contextWindow) && contextWindow > 0
      ? { model_context_window: contextWindow }
      : {})
  }
  return Object.keys(config).length ? { config } : {}
}
