import type { ChatFileChange, ChatTranscriptItem } from '../../shared/chat.js'
import { recordOfOrEmpty, stringOf } from '../json-coerce.js'
import { closedAiToolItem, jsonPreview, promoteCaptureToScreenshot } from '../tool-transcript-shared.js'

// Pure translations from Claude Code tool calls to the transcript vocabulary Codex items use,
// so the renderer's activity rows, diffs, and screenshots need no provider branches. Built-in
// tools map by name; ClosedAI tools arrive namespaced as `mcp__<namespace>__<tool>` and keep
// the `namespace · tool` label the Codex adapter gives MCP calls.

export type ToolUse = { id: string; name: string; input: Record<string, unknown> }
export type ToolResultContent = { content: unknown; isError: boolean }
export type DisplayScreenshot = (callId: string) => { dataUrl: string } | null

const PLAN_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
const MAX_OUTPUT_CHARS = 24_000
const MAX_DETAIL_CHARS = 4_000

export { recordOfOrEmpty as recordOf, stringOf } from '../json-coerce.js'
export { jsonPreview } from '../tool-transcript-shared.js'

export function parseMcpToolName(name: string): { namespace: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? { namespace: match[1]!, tool: match[2]! } : null
}

/** The transcript item for a tool call, before or after its arguments are known. */
export function toolUseItem(use: ToolUse, turnId: string | null, cwd: string): ChatTranscriptItem {
  const { id, name, input } = use
  if (name === 'Bash') {
    return { type: 'command', id, turnId, command: stringOf(input.command), cwd, status: 'inProgress', output: '', exitCode: null }
  }
  const change = fileChange(name, input)
  if (change) return { type: 'fileChange', id, turnId, status: 'inProgress', changes: [change] }
  if (PLAN_TOOLS.has(name)) return { type: 'plan', id, turnId, text: planText(name, input), streaming: false }
  const mcp = parseMcpToolName(name)
  if (mcp) return closedAiToolItem(id, turnId, mcp.namespace, mcp.tool, input)
  const { label, detail } = builtinLabel(name, input)
  return { type: 'tool', id, turnId, label, detail, status: 'inProgress' }
}

/** The same item once its result arrived: status, output, and the screenshot when the result carries one. */
export function toolResultItem(
  item: ChatTranscriptItem,
  result: ToolResultContent,
  displayScreenshot: DisplayScreenshot
): ChatTranscriptItem {
  const text = clip(resultText(result.content), MAX_OUTPUT_CHARS)
  const status = result.isError ? 'failed' : 'completed'
  if (item.type === 'command') {
    return { ...item, status, output: text, exitCode: result.isError ? exitCodeIn(text) : 0 }
  }
  if (item.type === 'fileChange') return { ...item, status }
  if (item.type !== 'tool') return item
  const screenshot = captureScreenshot(item, result, displayScreenshot)
  if (screenshot) return screenshot
  const output = clip(text, MAX_DETAIL_CHARS).trim()
  return output ? { ...item, status, output } : { ...item, status }
}

function captureScreenshot(
  item: Extract<ChatTranscriptItem, { type: 'tool' }>,
  result: ToolResultContent,
  displayScreenshot: DisplayScreenshot
): ChatTranscriptItem | null {
  if (result.isError || item.label !== 'closedai_ui · capture') return null
  const args = recordOfOrEmpty(parseJson(item.detail))
  const imageUrl = displayScreenshot(item.id)?.dataUrl ?? resultImageUrl(result.content)
  return promoteCaptureToScreenshot({
    itemId: item.id,
    turnId: item.turnId,
    failed: result.isError,
    namespace: 'closedai_ui',
    tool: 'capture',
    action: args.action,
    caption: resultText(result.content),
    imageUrl
  })
}

function fileChange(name: string, input: Record<string, unknown>): ChatFileChange | null {
  if (name === 'Write') {
    const path = stringOf(input.file_path)
    return path ? { path, kind: 'add', diff: prefixLines('+', stringOf(input.content)) } : null
  }
  if (name === 'Edit' || name === 'MultiEdit') {
    const path = stringOf(input.file_path)
    if (!path) return null
    const edits = Array.isArray(input.edits) ? input.edits.map(recordOfOrEmpty) : [input]
    const diff = edits.map(editDiff).filter(Boolean).join('\n@@\n')
    return { path, kind: 'update', diff }
  }
  if (name === 'NotebookEdit') {
    const path = stringOf(input.notebook_path)
    return path ? { path, kind: 'update', diff: prefixLines('+', stringOf(input.new_source)) } : null
  }
  return null
}

function editDiff(edit: Record<string, unknown>): string {
  const before = stringOf(edit.old_string)
  const after = stringOf(edit.new_string)
  return [before ? prefixLines('-', before) : '', after ? prefixLines('+', after) : ''].filter(Boolean).join('\n')
}

function prefixLines(prefix: string, text: string): string {
  return text ? text.split('\n').map((line) => `${prefix}${line}`).join('\n') : ''
}

function planText(name: string, input: Record<string, unknown>): string {
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    return input.todos.map((raw) => {
      const todo = recordOfOrEmpty(raw)
      const mark = todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '~' : ' '
      return `- [${mark}] ${stringOf(todo.content)}`
    }).join('\n')
  }
  if (name === 'TaskCreate') return `- [ ] ${stringOf(input.subject)}`
  return `- ${stringOf(input.taskId)}: ${stringOf(input.status) || 'updated'}`
}

function builtinLabel(name: string, input: Record<string, unknown>): { label: string; detail: string } {
  switch (name) {
    case 'Read': return { label: 'Read file', detail: stringOf(input.file_path) }
    case 'Glob': return { label: 'Search files', detail: stringOf(input.pattern) }
    case 'Grep': return { label: 'Search files', detail: stringOf(input.pattern) }
    case 'WebSearch': return { label: 'Web search', detail: stringOf(input.query) }
    case 'WebFetch': return { label: 'Fetch page', detail: stringOf(input.url) }
    case 'Task':
    case 'Agent': return { label: 'Subagent', detail: stringOf(input.description) || stringOf(input.prompt) }
    case 'ToolSearch': return { label: 'Tool search', detail: stringOf(input.query) }
    case 'Skill': return { label: 'Skill', detail: stringOf(input.skill) }
    default: return { label: name, detail: jsonPreview(input) }
  }
}

/** Text blocks of a tool result, joined; strings pass through. */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((entry) => {
    const block = recordOfOrEmpty(entry)
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('\n')
}

/** The first image of a tool result as a data URL (the SDK returns base64 source blocks). */
export function resultImageUrl(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  for (const entry of content) {
    const block = recordOfOrEmpty(entry)
    const source = recordOfOrEmpty(block.source)
    if (block.type === 'image' && source.type === 'base64' && typeof source.data === 'string') {
      return `data:${stringOf(source.media_type) || 'image/png'};base64,${source.data}`
    }
  }
  return null
}

function exitCodeIn(text: string): number | null {
  const match = /\bexit code[: ]+(\d+)/i.exec(text)
  return match ? Number(match[1]) : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
