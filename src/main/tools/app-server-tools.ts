import type { AppServerClient, AppServerRequest } from '../app-server-client.js'
import type { ToolRegistry } from './registry.js'
import type { ToolResult } from './tool.js'

// Adapter between the ToolRegistry and the Codex app-server protocol: tools are advertised
// as `dynamicTools` on thread/start + thread/resume, and Codex invokes one with an
// `item/tool/call` server request that must be answered with a DynamicToolCallResponse.

export type DynamicToolSpec = {
  type: 'namespace'
  name: string
  description: string
  tools: Array<{
    type: 'function'
    name: string
    description: string
    inputSchema: unknown
    deferLoading?: boolean
  }>
}

export type DynamicToolCallResponse = {
  contentItems: Array<{ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }>
  success: boolean
}

export const TOOL_CALL_METHOD = 'item/tool/call'

export function dynamicToolSpecs(registry: ToolRegistry): DynamicToolSpec[] {
  return registry.enabledNamespaces()
    .map((namespace) => ({
      type: 'namespace',
      name: namespace.name,
      description: namespace.description,
      tools: namespace.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.deferLoading ? { deferLoading: true } : {})
      }))
    }))
}

export function toolCallResponse(result: ToolResult): DynamicToolCallResponse {
  return {
    success: !result.isError,
    contentItems: result.content.map((item) =>
      item.type === 'image' ? { type: 'inputImage', imageUrl: item.dataUrl } : { type: 'inputText', text: item.text }
    )
  }
}

export class AppServerToolCalls {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly client: Pick<AppServerClient, 'respond' | 'respondWithError'>
  ) {}

  /** Returns false when the request is not a tool call, so the caller can route it elsewhere. */
  handle(request: AppServerRequest): boolean {
    if (request.method !== TOOL_CALL_METHOD) return false
    const params = request.params !== null && typeof request.params === 'object' ? request.params as Record<string, unknown> : {}
    const tool = typeof params.tool === 'string' ? params.tool : ''
    if (!tool) {
      this.client.respondWithError(request.id, -32602, 'item/tool/call is missing `tool`')
      return true
    }
    void this.registry
      .call(
        { namespace: typeof params.namespace === 'string' ? params.namespace : null, tool, arguments: params.arguments },
        {
          threadId: typeof params.threadId === 'string' ? params.threadId : null,
          turnId: typeof params.turnId === 'string' ? params.turnId : null,
          callId: typeof params.callId === 'string' ? params.callId : String(request.id)
        }
      )
      .then((result) => this.client.respond(request.id, toolCallResponse(result)))
      .catch((error: unknown) => {
        this.client.respondWithError(request.id, -32603, error instanceof Error ? error.message : String(error))
      })
    return true
  }
}
