import type { ToolResult } from './tool.js'

// A registry result in the MCP content vocabulary. Shared by every adapter that answers an MCP
// tool call — the Claude Agent SDK's in-process servers and the HTTP bridge the CLI-backed
// providers use — because the content shape is MCP's, not any one provider's.

export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type McpToolResult = { content: McpToolContent[]; isError?: boolean }

/** Data URLs become image blocks; anything that cannot be encoded says so as text. */
export function mcpToolResult(result: ToolResult): McpToolResult {
  const content = result.content.flatMap((item): McpToolContent[] => {
    if (item.type === 'text') return [{ type: 'text', text: item.text }]
    const image = imageBlock(item.dataUrl)
    return image ? [image] : [{ type: 'text', text: '[image could not be encoded]' }]
  })
  return { content, ...(result.isError ? { isError: true } : {}) }
}

function imageBlock(dataUrl: string): McpToolContent | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  return match ? { type: 'image', data: match[2]!, mimeType: match[1]! } : null
}
