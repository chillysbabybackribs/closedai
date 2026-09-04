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

function sharedThreadParams(cwd: string, tools: ToolRegistry): Record<string, unknown> {
  return {
    cwd,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    developerInstructions: closedAiDeveloperInstructions(),
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
