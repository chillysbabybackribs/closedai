import { dynamicToolSpecs } from '../tools/app-server-tools.js'
import type { ToolRegistry } from '../tools/registry.js'
import { closedAiDeveloperInstructions } from './developer-instructions.js'
import { workspaceNavigationSection } from './workspace-navigation.js'

/**
 * Product guidance plus a small app-authored orientation capsule. Repository-derived
 * details stay out of trusted instructions and are available through a deferred tool.
 */
function threadInstructions(cwd: string): string {
  const instructions = closedAiDeveloperInstructions()
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
