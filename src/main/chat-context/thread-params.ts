import { dynamicToolSpecs } from '../tools/app-server-tools.js'
import type { ToolRegistry } from '../tools/registry.js'
import { closedAiDeveloperInstructions } from './developer-instructions.js'
import { workspaceMapSection } from './workspace-map.js'

/**
 * Product guidance plus, when the thread runs in the mapped checkout, the generated
 * workspace map. Threads pay this once at start/resume rather than re-deriving layout
 * through exec calls whose results replay on every later turn.
 */
function threadInstructions(cwd: string): string {
  const instructions = closedAiDeveloperInstructions()
  const map = workspaceMapSection(cwd)
  return map ? `${instructions}\n\n${map}` : instructions
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
