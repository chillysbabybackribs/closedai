import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { mcpToolResult, type McpToolContent, type McpToolResult } from '../tools/mcp-tool-result.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ClaudeSdk } from './claude-sdk.js'
import { zodShapeFromJsonSchema } from '../tools/json-schema-zod.js'

// Adapter between the ToolRegistry and the Claude Agent SDK: every enabled namespace becomes
// one in-process MCP server named after it, so the model sees `mcp__embedded_browser__page`
// where Codex sees `embedded_browser.page`, and every call runs through the SAME registry
// (validation, timeouts, telemetry, the Tools modal's switches). Verified 2026-09-02 against
// SDK 0.3.258: SDK MCP tools are deferred behind ToolSearch unless `alwaysLoad` is set, and
// the handler's `extra._meta['claudecode/toolUseId']` carries the tool_use id, which the
// transcript uses as the item id (and the screenshot store as its key).

export type ClaudeToolContext = () => { paneId?: string | null; threadId: string | null; turnId: string | null }

/** MCP content blocks the SDK accepts back from a tool handler; the shape is MCP's, not the SDK's. */
export type ClaudeToolContent = McpToolContent
export type ClaudeToolResult = McpToolResult

/** The shared serializer under the name this lane's call sites and tests already use. */
export const claudeToolResult = mcpToolResult

type ToolFactory = Pick<ClaudeSdk, 'tool' | 'createSdkMcpServer'>

export function claudeMcpServers(
  sdk: ToolFactory,
  registry: ToolRegistry,
  context: ClaudeToolContext
): Record<string, McpSdkServerConfigWithInstance> {
  const servers: Record<string, McpSdkServerConfigWithInstance> = {}
  for (const namespace of registry.enabledNamespaces()) {
    const tools = namespace.tools.map((tool) => sdk.tool(
      tool.name,
      tool.description,
      zodShapeFromJsonSchema(tool.inputSchema).shape,
      async (args, extra) => {
        const { paneId, threadId, turnId } = context()
        const result = await registry.call(
          { namespace: namespace.name, tool: tool.name, arguments: args },
          { paneId, threadId, turnId, callId: toolUseIdOf(extra) ?? crypto.randomUUID(), source: 'model' }
        )
        return mcpToolResult(result)
      },
      { alwaysLoad: !tool.deferLoading }
    ))
    servers[namespace.name] = sdk.createSdkMcpServer({
      name: namespace.name,
      version: '0.1.0',
      instructions: namespace.description,
      tools
    })
  }
  return servers
}

/** The SDK stamps the model's tool_use id on the MCP request metadata. */
export function toolUseIdOf(extra: unknown): string | null {
  const meta = extra !== null && typeof extra === 'object' ? (extra as { _meta?: unknown })._meta : null
  const id = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>)['claudecode/toolUseId'] : null
  return typeof id === 'string' && id ? id : null
}
