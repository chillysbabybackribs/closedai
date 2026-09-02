import { dynamicToolSpecs } from '../tools/app-server-tools.js'
import type { ToolRegistry } from '../tools/registry.js'
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
  tools: ToolRegistry
): Record<string, unknown> {
  return {
    threadId,
    ...sharedThreadParams(cwd, tools),
    excludeTurns: false
  }
}

export function startThreadParams(
  cwd: string,
  tools: ToolRegistry,
  model: string | null
): Record<string, unknown> {
  return {
    ...sharedThreadParams(cwd, tools),
    serviceName: 'closedai',
    ...(model ? { model } : {})
  }
}
