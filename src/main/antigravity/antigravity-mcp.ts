import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { zodShapeFromJsonSchema } from '../tools/json-schema-zod.js'
import { claudeToolResult } from '../claude/claude-tools.js'
import type { ToolRegistry } from '../tools/registry.js'
import { ANTIGRAVITY_MCP_CONFIG_PATH, runAntigravityCommand } from './antigravity-cli.js'

// Adapter between the ToolRegistry and the Antigravity CLI. `agy` is a separate process, so the
// registry is served over MCP on localhost: one streamable-HTTP endpoint per enabled namespace
// (`/mcp/<namespace>`), registered in the CLI's global MCP config under the namespace's name so
// the model sees `mcp_embedded_browser_page` where Claude sees `mcp__embedded_browser__page`.
// Every call runs through the SAME registry (validation, timeouts, telemetry, the Tools modal).
//
// Verified live against agy 1.1.24 and SDK 1.30 (2026-09-02):
// - The CLI POSTs `initialize` and then opens a standalone GET SSE stream, so the transport
//   must be stateful (one per mcp-session-id); it also probes /.well-known/oauth-* (404 is fine).
// - Registration is global and only through `agy mcp add/enable/remove`; there is no per-spawn
//   flag. `mcp add` writes `{serverUrl}` and drops any per-tool flags, so the eager map
//   (`tools: {<name>: {eager: true}}`, which turns a tool into a direct declaration instead of
//   hiding it behind the generic call_mcp_tool gateway) is restored by rewriting the file after.
// - Each tools/call carries `_meta['antigravity.google/conversation_id']`; the service binds
//   conversation ids to its pane and turn, which becomes the registry's call context.
// - The config is one file for every app instance. The default profile registers bare namespace
//   names; any other profile (a second checkout, a test run) suffixes a stable hash so it never
//   redirects the user's running app at its own bridge.

export type AntigravityServer = { server: string; namespace: string }

export type AntigravityCallContext = { paneId: string | null; threadId: string | null; turnId: string | null }

type Session = { transport: StreamableHTTPServerTransport; server: McpServer }
type ServedCall = { namespace: string; tool: string; callId: string }

const CONVERSATION_META = 'antigravity.google/conversation_id'
const MAX_LEDGER = 50

export class AntigravityToolBridge {
  private http: Server | null = null
  private port: number | null = null
  private starting: Promise<void> | null = null
  private readonly sessions = new Map<string, Session>()
  private readonly bindings = new Map<string, AntigravityCallContext>()
  private readonly ledger = new Map<string, ServedCall[]>()
  private registered: string[] = []

  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: { configPath?: string; binary?: string; profileKey?: string | null } = {}
  ) {}

  /** The MCP server name a namespace is registered under for this profile. */
  serverName(namespace: string): string {
    return this.options.profileKey ? `${namespace}_${this.options.profileKey}` : namespace
  }

  /** Servers the CLI was pointed at (empty before the first start), with the namespace each serves. */
  servers(): AntigravityServer[] {
    return this.registered.map((namespace) => ({ server: this.serverName(namespace), namespace }))
  }

  /** Listen and register every enabled namespace with the CLI; cheap once done. */
  start(): Promise<void> {
    this.starting ??= this.doStart().catch((error: unknown) => {
      this.starting = null
      throw error
    })
    return this.starting
  }

  /** Drop the app's entries from the CLI config and close the server. */
  async stop(): Promise<void> {
    const names = this.registered
    this.registered = []
    this.starting = null
    await this.rewriteConfig((servers) => { for (const name of names) delete servers[this.serverName(name)] })
    for (const session of this.sessions.values()) await session.transport.close().catch(() => {})
    this.sessions.clear()
    await new Promise<void>((resolve) => (this.http ? this.http.close(() => resolve()) : resolve()))
    this.http = null
    this.port = null
  }

  bind(conversationId: string, context: AntigravityCallContext): void {
    this.bindings.set(conversationId, context)
  }

  unbind(conversationId: string): void {
    this.bindings.delete(conversationId)
    this.ledger.delete(conversationId)
  }

  /** The registry call id behind the conversation's oldest unclaimed call of that tool. */
  takeCallId(conversationId: string | null, namespace: string, tool: string): string | null {
    if (!conversationId) return null
    const calls = this.ledger.get(conversationId)
    const index = calls?.findIndex((call) => call.namespace === namespace && call.tool === tool) ?? -1
    if (!calls || index < 0) return null
    const [call] = calls.splice(index, 1)
    return call?.callId ?? null
  }

  private async doStart(): Promise<void> {
    const http = createServer((req, res) => { void this.handle(req, res) })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', () => resolve())
    })
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('Antigravity tool bridge could not bind a port')
    this.http = http
    this.port = address.port
    await this.register()
  }

  private async register(): Promise<void> {
    const namespaces = this.registry.enabledNamespaces()
    const registered: string[] = []
    for (const namespace of namespaces) {
      const url = `http://127.0.0.1:${this.port}/mcp/${namespace.name}`
      const server = this.serverName(namespace.name)
      if (await this.cli(['mcp', 'add', '--type', 'http', server, url]) && await this.cli(['mcp', 'enable', server])) {
        registered.push(namespace.name)
      } else {
        console.warn(`[antigravity] could not register tool namespace ${namespace.name} with agy`)
      }
    }
    this.registered = registered
    await this.exposeEagerTools(namespaces.filter((namespace) => registered.includes(namespace.name)))
  }

  /** `agy mcp add` drops per-tool flags; put the eager map back so tools are direct declarations. */
  private exposeEagerTools(namespaces: ReturnType<ToolRegistry['enabledNamespaces']>): Promise<void> {
    return this.rewriteConfig((servers) => {
      for (const namespace of namespaces) {
        const server = servers[this.serverName(namespace.name)]
        if (!server) continue
        server.tools = Object.fromEntries(namespace.tools.filter((tool) => !tool.deferLoading).map((tool) => [tool.name, { eager: true }]))
      }
    })
  }

  /**
   * Edit the CLI's config file in place. The CLI does not rewrite it on exit (verified: an entry
   * removed while a chat process ran stayed removed), so this is safe once no `mcp` verb is running.
   */
  private async rewriteConfig(edit: (servers: Record<string, Record<string, unknown>>) => void): Promise<void> {
    const path = this.options.configPath ?? ANTIGRAVITY_MCP_CONFIG_PATH
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { mcpServers?: Record<string, Record<string, unknown>> }
      const servers = parsed.mcpServers ?? {}
      edit(servers)
      await writeFile(path, `${JSON.stringify({ ...parsed, mcpServers: servers }, null, 2)}\n`)
    } catch (error) {
      console.warn('[antigravity] could not update the agy MCP config:', error instanceof Error ? error.message : error)
    }
  }

  private async cli(args: string[]): Promise<boolean> {
    const result = await runAntigravityCommand(args, { binary: this.options.binary })
    if (!result.ok) console.warn(`[antigravity] agy ${args.join(' ')} failed: ${result.stderr.trim() || result.code}`)
    return result.ok
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const match = /^\/mcp\/([a-z0-9_]+)\/?$/i.exec(req.url ?? '')
      if (!match) {
        res.writeHead(404).end()
        return
      }
      const namespace = match[1]!
      const sessionId = req.headers['mcp-session-id']
      const existing = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
      const body = req.method === 'POST' ? await readJson(req) : undefined
      if (existing) {
        await existing.transport.handleRequest(req, res, body)
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(400).end('Unknown MCP session')
        return
      }
      const session = this.createSession(namespace)
      await session.server.connect(session.transport)
      await session.transport.handleRequest(req, res, body)
    } catch (error) {
      console.warn('[antigravity] MCP request failed:', error instanceof Error ? error.message : error)
      if (!res.headersSent) res.writeHead(500).end()
    }
  }

  /** One server per MCP session (the SDK allows one transport per server), built from the namespace's live tools. */
  private createSession(namespaceName: string): Session {
    const namespace = this.registry.enabledNamespaces().find((entry) => entry.name === namespaceName)
    const server = new McpServer({ name: namespaceName, version: '0.1.0' }, { instructions: namespace?.description ?? '' })
    for (const tool of namespace?.tools ?? []) {
      server.registerTool(tool.name, { description: tool.description, inputSchema: zodShapeFromJsonSchema(tool.inputSchema).shape }, async (args, extra) => {
        const conversationId = conversationIdOf(extra)
        const context = this.contextFor(conversationId)
        const callId = randomUUID()
        const result = await this.registry.call(
          { namespace: namespaceName, tool: tool.name, arguments: args as Record<string, unknown> },
          { paneId: context.paneId, threadId: context.threadId, turnId: context.turnId, callId }
        )
        if (conversationId) this.recordCall(conversationId, { namespace: namespaceName, tool: tool.name, callId })
        return claudeToolResult(result)
      })
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { this.sessions.set(id, { transport, server }) }
    })
    transport.onclose = () => { if (transport.sessionId) this.sessions.delete(transport.sessionId) }
    return { transport, server }
  }

  private contextFor(conversationId: string | null): AntigravityCallContext {
    const bound = conversationId ? this.bindings.get(conversationId) : undefined
    if (bound) return bound
    // A call before the binding landed: the one pane with a turn running is the caller.
    const active = [...this.bindings.values()].filter((context) => context.turnId)
    return active.length === 1 ? active[0]! : { paneId: null, threadId: null, turnId: null }
  }

  private recordCall(conversationId: string, call: ServedCall): void {
    const calls = this.ledger.get(conversationId) ?? []
    calls.push(call)
    if (calls.length > MAX_LEDGER) calls.splice(0, calls.length - MAX_LEDGER)
    this.ledger.set(conversationId, calls)
  }
}

function conversationIdOf(extra: unknown): string | null {
  const meta = extra !== null && typeof extra === 'object' ? (extra as { _meta?: unknown })._meta : null
  const id = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>)[CONVERSATION_META] : null
  return typeof id === 'string' && id ? id : null
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}
