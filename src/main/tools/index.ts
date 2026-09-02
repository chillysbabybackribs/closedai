import { ToolRegistry } from './registry.js'
import type { ToolNamespace } from './tool.js'

/**
 * The complete tool set the app offers. Add a namespace here (one directory per
 * namespace, one file per tool) and it reaches every provider adapter.
 */
export function createToolRegistry(namespaces: ToolNamespace[] = []): ToolRegistry {
  return new ToolRegistry(namespaces)
}

export { browserTools } from './browser/index.js'
export { cdpTools } from './cdp/index.js'
export { captureTools } from './capture/index.js'
export { defineActionTool } from './action-tool.js'
export type { ActionToolOptions, ToolAction } from './action-tool.js'
export { defineTool, failureResult, textResult } from './tool.js'
export { ToolRegistry } from './registry.js'
export type { ToolCallRequest } from './registry.js'
export type { ToolContent, ToolDefinition, ToolNamespace, ToolResult } from './tool.js'
