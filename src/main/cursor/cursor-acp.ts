import { readFile, writeFile } from 'node:fs/promises'
import { StdioJsonRpcClient, type JsonRpcRequest } from '../stdio-json-rpc.js'
import type { TraceScope } from '../trace/trace-log.js'
import { summarizeCursorRpc } from '../trace/summaries.js'
import { cursorAcpArgs, cursorBinary } from './cursor-cli.js'

// The Agent Client Protocol half of the Cursor provider: JSON-RPC 2.0 over the ACP server's
// stdio, on the shared stdio client. Verified live against cursor-agent 2026.09.02-c22c1a3 on
// 2026-09-03.
//
// We drive: initialize, session/new, session/load, session/list, session/prompt, session/cancel,
// session/set_model, session/set_mode. The agent drives back: session/update (the whole
// transcript stream), session/request_permission, and fs/read_text_file + fs/write_text_file.
//
// Two decisions this file makes:
// - `terminal` is NOT advertised. The agent then runs commands itself and reports them as
//   `tool_call` updates, which is what the transcript wants anyway; advertising it would oblige
//   us to implement a terminal we would only be proxying back to the same machine.
// - Permission requests are answered automatically with the broadest allow the request offers.
//   ClosedAI never shows provider approval dialogs, and answering in-protocol is narrower than
//   the CLI's blanket `--force`.

export type AcpModel = { modelId: string; name: string }
export type AcpMode = { id: string; name: string; description?: string }

export type AcpSessionSetup = {
  sessionId: string
  models: AcpModel[]
  modes: AcpMode[]
  currentModelId: string | null
  currentModeId: string | null
}

export type AcpCapabilities = {
  loadSession: boolean
  listSessions: boolean
  image: boolean
  mcpHttp: boolean
}

export type AcpPromptBlock = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }

export type AcpStopReason = 'end_turn' | 'cancelled' | 'max_tokens' | 'refusal' | string

/**
 * An MCP server the agent should connect to for the life of a session. `headers` is required, not
 * optional: omitting it fails `session/new` schema validation with "expected array" (verified).
 */
export type AcpMcpServer = { type: 'http'; name: string; url: string; headers: Array<{ name: string; value: string }> }

const PROTOCOL_VERSION = 1
const PROMPT_TIMEOUT_MS = 60 * 60_000

export class CursorAcpClient extends StdioJsonRpcClient {
  private caps: AcpCapabilities | null = null

  constructor(cwd: string, traceScope: (() => TraceScope) | null = null) {
    super({
      peer: 'Cursor ACP',
      executable: cursorBinary(),
      cwd,
      args: cursorAcpArgs,
      version: '2.0',
      trace: traceScope
        ? {
            scope: traceScope,
            label: (direction) => (direction === 'in' ? 'cursor.in' : 'cursor.out'),
            summarize: summarizeCursorRpc
          }
        : null
    })
    this.on('request', (request: JsonRpcRequest) => { void this.serve(request) })
  }

  /** What the agent said it can do; null until `start` has completed a handshake. */
  get capabilities(): AcpCapabilities | null {
    return this.caps
  }

  override async start(): Promise<void> {
    if (this.connected) return
    await super.start()
    try {
      const result = await this.request<Record<string, unknown>>('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }
      })
      this.caps = readCapabilities(result)
    } catch (error) {
      this.stop()
      throw error
    }
  }

  newSession(cwd: string, mcpServers: readonly AcpMcpServer[]): Promise<AcpSessionSetup> {
    return this.setup('session/new', { cwd, mcpServers })
  }

  /** Reopen a session the agent still holds; only valid when `capabilities.loadSession`. */
  loadSession(sessionId: string, cwd: string, mcpServers: readonly AcpMcpServer[]): Promise<AcpSessionSetup> {
    return this.setup('session/load', { sessionId, cwd, mcpServers })
  }

  async listSessions(cwd: string): Promise<Array<{ sessionId: string; title?: string; updatedAt?: string }>> {
    const result = await this.request<Record<string, unknown>>('session/list', { cwd })
    const sessions = Array.isArray(result?.sessions) ? result.sessions : []
    return sessions.flatMap((entry) => {
      const record = asRecord(entry)
      const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : null
      if (!sessionId) return []
      return [{
        sessionId,
        ...(typeof record?.title === 'string' ? { title: record.title } : {}),
        ...(typeof record?.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {})
      }]
    })
  }

  async prompt(sessionId: string, blocks: readonly AcpPromptBlock[]): Promise<AcpStopReason> {
    const result = await this.request<Record<string, unknown>>(
      'session/prompt',
      { sessionId, prompt: blocks },
      PROMPT_TIMEOUT_MS
    )
    return typeof result?.stopReason === 'string' ? result.stopReason : 'end_turn'
  }

  async cancel(sessionId: string): Promise<void> {
    await this.request('session/cancel', { sessionId }, 10_000).catch(() => undefined)
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.request('session/set_model', { sessionId, modelId })
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.request('session/set_mode', { sessionId, modeId })
  }

  private async setup(method: string, params: Record<string, unknown>): Promise<AcpSessionSetup> {
    const result = await this.request<Record<string, unknown>>(method, params, 60_000)
    const models = asRecord(result?.models)
    const modes = asRecord(result?.modes)
    return {
      sessionId: typeof result?.sessionId === 'string' ? result.sessionId : String(params.sessionId ?? ''),
      models: readModels(models?.availableModels),
      modes: readModes(modes?.availableModes),
      currentModelId: typeof models?.currentModelId === 'string' ? models.currentModelId : null,
      currentModeId: typeof modes?.currentModeId === 'string' ? modes.currentModeId : null
    }
  }

  /** Answer the requests the agent makes of its client. */
  private async serve(request: JsonRpcRequest): Promise<void> {
    const params = asRecord(request.params) ?? {}
    try {
      if (request.method === 'session/request_permission') {
        this.respond(request.id, { outcome: { outcome: 'selected', optionId: allowOption(params) } })
        return
      }
      if (request.method === 'fs/read_text_file') {
        const content = await readFile(String(params.path), 'utf8')
        this.respond(request.id, { content: clipLines(content, params) })
        return
      }
      if (request.method === 'fs/write_text_file') {
        await writeFile(String(params.path), String(params.content ?? ''), 'utf8')
        this.respond(request.id, {})
        return
      }
      // Anything else (a capability we did not advertise) is refused rather than left hanging.
      this.respondWithError(request.id, -32601, `ClosedAI does not implement ${request.method}`)
    } catch (error) {
      this.respondWithError(request.id, -32000, error instanceof Error ? error.message : String(error))
    }
  }
}

/** The broadest allow the request offers, so a turn never stalls on an approval nobody will see. */
function allowOption(params: Record<string, unknown>): string {
  const listed: unknown[] = Array.isArray(params.options) ? params.options : []
  const options: Array<Record<string, unknown>> = listed.flatMap((entry) => {
    const record = asRecord(entry)
    return record ? [record] : []
  })
  const byKind = (kind: string): string | null => {
    const found = options.find((option) => option.kind === kind || option.optionId === kind)
    return typeof found?.optionId === 'string' ? found.optionId : null
  }
  const allows = options.filter((option) =>
    /allow/i.test(String(option.kind ?? '')) || /allow/i.test(String(option.optionId ?? ''))
  )
  return byKind('allow_always')
    ?? byKind('allow-always')
    ?? (typeof allows[0]?.optionId === 'string' ? allows[0].optionId : null)
    ?? (typeof options[0]?.optionId === 'string' ? options[0].optionId : 'allow')
}

/** ACP lets a read request name a window; honouring it keeps large files out of the agent's context. */
function clipLines(content: string, params: Record<string, unknown>): string {
  const line = typeof params.line === 'number' ? Math.max(1, Math.trunc(params.line)) : 1
  const limit = typeof params.limit === 'number' ? Math.max(0, Math.trunc(params.limit)) : null
  if (line === 1 && limit === null) return content
  const lines = content.split('\n')
  return lines.slice(line - 1, limit === null ? undefined : line - 1 + limit).join('\n')
}

function readCapabilities(result: Record<string, unknown> | null): AcpCapabilities {
  const agent = asRecord(result?.agentCapabilities)
  const mcp = asRecord(agent?.mcpCapabilities)
  const prompt = asRecord(agent?.promptCapabilities)
  const sessions = asRecord(agent?.sessionCapabilities)
  return {
    loadSession: agent?.loadSession === true,
    listSessions: asRecord(sessions?.list) !== null,
    image: prompt?.image === true,
    mcpHttp: mcp?.http === true
  }
}

function readModels(value: unknown): AcpModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asRecord(entry)
    const modelId = typeof record?.modelId === 'string' ? record.modelId : null
    if (!modelId) return []
    return [{ modelId, name: typeof record?.name === 'string' ? record.name : modelId }]
  })
}

function readModes(value: unknown): AcpMode[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asRecord(entry)
    const id = typeof record?.id === 'string' ? record.id : null
    if (!id) return []
    return [{
      id,
      name: typeof record?.name === 'string' ? record.name : id,
      ...(typeof record?.description === 'string' ? { description: record.description } : {})
    }]
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
