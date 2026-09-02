import type { ChatFileChange, ChatTranscriptItem } from '../../shared/chat.js'
import { jsonPreview, recordOf, stringOf } from '../claude/claude-tool-items.js'

// Pure translations from `agy` tool steps to the transcript vocabulary Codex items use, so the
// renderer's activity rows and diffs need no provider branches. Native tools map by name and
// their PascalCase parameters (verified live: run_command{CommandLine}, view_file{AbsolutePath},
// write_to_file{TargetFile} with the content withheld from the event). ClosedAI tools arrive as
// eager MCP declarations named `mcp_<namespace>_<tool>` and keep the `namespace · tool` label
// the other adapters give MCP calls; the legacy `call_mcp_tool` gateway wraps the same call.

export type AntigravityToolCall = { id: string; name: string; parameters: Record<string, unknown> }
export type AntigravityToolOutcome = { output: string; failed: boolean }
export type ResolvedAntigravityTool = { namespace: string | null; tool: string; parameters: Record<string, unknown> }
/** An MCP server name the CLI knows and the registry namespace it serves. */
export type AntigravityServerName = { server: string; namespace: string }

const MAX_OUTPUT_CHARS = 24_000

/** Split an MCP declaration into the ClosedAI namespace and tool it names; native tools keep no namespace. */
export function resolveAntigravityTool(name: string, parameters: Record<string, unknown>, servers: readonly AntigravityServerName[]): ResolvedAntigravityTool {
  if (name === 'call_mcp_tool') {
    const inner = stringOf(parameters.ToolName)
    const args = recordOf(parameters.Arguments)
    return inner ? resolveAntigravityTool(inner, args, servers) : { namespace: null, tool: name, parameters }
  }
  for (const { server, namespace } of servers) {
    const prefix = `mcp_${server}_`
    if (name.startsWith(prefix) && name.length > prefix.length) return { namespace, tool: name.slice(prefix.length), parameters }
  }
  return { namespace: null, tool: name, parameters }
}

/** The transcript item for a tool step as it starts. */
export function antigravityToolItem(call: AntigravityToolCall, turnId: string | null, cwd: string, servers: readonly AntigravityServerName[]): ChatTranscriptItem {
  const { id } = call
  const resolved = resolveAntigravityTool(call.name, call.parameters, servers)
  const input = resolved.parameters
  if (resolved.namespace) {
    return { type: 'tool', id, turnId, label: `${resolved.namespace} · ${resolved.tool}`, detail: jsonPreview(input), status: 'inProgress' }
  }
  const name = resolved.tool
  if (name === 'run_command') {
    return { type: 'command', id, turnId, command: stringOf(input.CommandLine), cwd: stringOf(input.Cwd) || cwd, status: 'inProgress', output: '', exitCode: null }
  }
  const change = fileChange(name, input)
  if (change) return { type: 'fileChange', id, turnId, status: 'inProgress', changes: [change] }
  const { label, detail } = nativeLabel(name, input)
  return { type: 'tool', id, turnId, label, detail, status: 'inProgress' }
}

/** The same item once the step settled. */
export function antigravityToolResult(item: ChatTranscriptItem, outcome: AntigravityToolOutcome): ChatTranscriptItem {
  const status = outcome.failed ? 'failed' : 'completed'
  const output = clip(outcome.output)
  if (item.type === 'command') return { ...item, status, output, exitCode: outcome.failed ? exitCodeIn(output) : 0 }
  if (item.type === 'fileChange') return { ...item, status }
  if (item.type === 'tool') return { ...item, status, detail: item.detail || (outcome.failed ? output : '') }
  return item
}

function fileChange(name: string, input: Record<string, unknown>): ChatFileChange | null {
  const path = stringOf(input.TargetFile) || stringOf(input.AbsolutePath) || stringOf(input.NotebookPath)
  if (!path) return null
  if (name === 'write_to_file') return { path, kind: 'add', diff: prefixLines('+', stringOf(input.CodeContent)) }
  if (name === 'replace_file_content') {
    return { path, kind: 'update', diff: editDiff(stringOf(input.TargetContent), stringOf(input.ReplacementContent)) }
  }
  if (name === 'multi_replace_file_content') {
    const chunks = Array.isArray(input.ReplacementChunks) ? input.ReplacementChunks.map(recordOf) : []
    const diff = chunks.map((chunk) => editDiff(stringOf(chunk.TargetContent), stringOf(chunk.ReplacementContent))).filter(Boolean).join('\n@@\n')
    return { path, kind: 'update', diff }
  }
  if (name === 'notebook_edit') return { path, kind: 'update', diff: prefixLines('+', stringOf(input.NewSource)) }
  return null
}

function editDiff(before: string, after: string): string {
  return [before ? prefixLines('-', before) : '', after ? prefixLines('+', after) : ''].filter(Boolean).join('\n')
}

function prefixLines(prefix: string, text: string): string {
  return text ? text.split('\n').map((line) => `${prefix}${line}`).join('\n') : ''
}

function nativeLabel(name: string, input: Record<string, unknown>): { label: string; detail: string } {
  switch (name) {
    case 'view_file': return { label: 'Read file', detail: stringOf(input.AbsolutePath) }
    case 'list_dir': return { label: 'List directory', detail: stringOf(input.DirectoryPath) }
    case 'grep_search': return { label: 'Search files', detail: stringOf(input.Query) }
    case 'find_by_name': return { label: 'Search files', detail: stringOf(input.Pattern) }
    case 'manage_task': return { label: 'Tasks', detail: jsonPreview(input) }
    case 'search_web': return { label: 'Web search', detail: stringOf(input.query) || stringOf(input.Query) }
    case 'read_url_content': return { label: 'Fetch page', detail: stringOf(input.Url) }
    default: return { label: name, detail: jsonPreview(input) }
  }
}

function exitCodeIn(text: string): number | null {
  const match = /\bexit (?:code|status)[: ]+(\d+)/i.exec(text)
  return match ? Number(match[1]) : null
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : text
}
