import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { zodShapeFromJsonSchema } from './json-schema-zod.js'
import { mcpToolResult } from './mcp-tool-result.js'
import type { ToolRegistry } from './registry.js'

// Serving the ToolRegistry over MCP to a provider that runs in its own process. Two do: the
// Antigravity CLI and the Cursor ACP server. Both want streamable-HTTP endpoints on localhost,
// one per enabled namespace, and both need a call to be attributed back to the pane and turn
// that caused it — so the listener, the per-namespace MCP servers, the registry dispatch, and
// the call ledger live here once. What differs is only how a provider is told about the servers
// and how a call names its caller, which each provider's own bridge supplies.
//
// Two routing shapes are supported, because the providers differ in when they can name a call:
// - **Keyed by path** (`/mcp/<key>/<namespace>`): the caller key is minted before the session
//   exists and baked into the URL. Cursor takes its server list as a `session/new` parameter,
//   so this is exact and needs no cooperation from the CLI.
// - **Keyed by `_meta`** (`/mcp/<namespace>`): one shared endpoint set, with each call carrying
//   an id the provider stamps on it. Antigravity's CLI registers servers globally in one config
//   file, so it has no per-session URL to carry a key.

export type McpNamespaceEndpoint = { namespace: string; url: string }

/** Which pane, thread, and turn a served call belongs to. */
export type McpCallContext = { paneId: string | null; threadId: string | null; turnId: string | null }

type ServedCall = { namespace: string; tool: string; callId: string }
type Session = { transport: StreamableHTTPServerTransport; server: McpServer }

export type McpHttpBridgeOptions = {
  /** How warnings name this bridge, e.g. `antigravity`. */
  label: string
  /** True when the caller key is a URL segment; false when it arrives on each call's `_meta`. */
  keyedByPath: boolean
  /** Reads the caller key from an MCP call's `_meta`; used only when `keyedByPath` is false. */
  keyFromMeta?: (extra: unknown) => string | null
}

const MAX_LEDGER = 50

export class McpHttpBridge {
  private http: Server | null = null
  private port: number | null = null
  private starting: Promise<void> | null = null
  private readonly sessions = new Map<string, Session>()
  private readonly bindings = new Map<string, McpCallContext>()
  private readonly ledger = new Map<string, ServedCall[]>()

  constructor(
    protected readonly registry: ToolRegistry,
    private readonly bridgeOptions: McpHttpBridgeOptions
  ) {}

  /** Listen on localhost. Cheap once done; concurrent callers share the one start. */
  start(): Promise<void> {
    this.starting ??= this.listen().catch((error: unknown) => {
      this.starting = null
      throw error
    })
    return this.starting
  }

  async stop(): Promise<void> {
    this.starting = null
    for (const session of this.sessions.values()) await session.transport.close().catch(() => {})
    this.sessions.clear()
    await new Promise<void>((resolve) => (this.http ? this.http.close(() => resolve()) : resolve()))
    this.http = null
    this.port = null
  }

  get listening(): boolean {
    return this.port !== null
  }

  /** One endpoint per enabled namespace, for a caller identified by `key` when keyed by path. */
  endpoints(key?: string): McpNamespaceEndpoint[] {
    if (this.port === null) return []
    const prefix = this.bridgeOptions.keyedByPath && key ? `/mcp/${encodeURIComponent(key)}` : '/mcp'
    return this.registry.enabledNamespaces().map((namespace) => ({
      namespace: namespace.name,
      url: `http://127.0.0.1:${this.port}${prefix}/${namespace.name}`
    }))
  }

  bind(key: string, context: McpCallContext): void {
    this.bindings.set(key, context)
  }

  unbind(key: string): void {
    this.bindings.delete(key)
    this.ledger.delete(key)
  }

  /** The registry call id behind that caller's oldest unclaimed call of the tool. */
  takeCallId(key: string | null, namespace: string, tool: string): string | null {
    if (!key) return null
    const calls = this.ledger.get(key)
    const index = calls?.findIndex((call) => call.namespace === namespace && call.tool === tool) ?? -1
    if (!calls || index < 0) return null
    const [call] = calls.splice(index, 1)
    return call?.callId ?? null
  }

  private async listen(): Promise<void> {
    const http = createServer((req, res) => { void this.handle(req, res) })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', () => resolve())
    })
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error(`${this.bridgeOptions.label} tool bridge could not bind a port`)
    this.http = http
    this.port = address.port
    await this.onListening()
  }

  /** Hook for a provider that must announce the endpoints once the port is known. */
  protected onListening(): Promise<void> {
    return Promise.resolve()
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const route = this.route(req.url ?? '')
      if (!route) {
        res.writeHead(404).end()
        return
      }
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
      const session = this.createSession(route.namespace, route.key)
      await session.server.connect(session.transport)
      await session.transport.handleRequest(req, res, body)
    } catch (error) {
      console.warn(`[${this.bridgeOptions.label}] MCP request failed:`, error instanceof Error ? error.message : error)
      if (!res.headersSent) res.writeHead(500).end()
    }
  }

  private route(url: string): { key: string | null; namespace: string } | null {
    const path = url.split('?')[0] ?? ''
    if (this.bridgeOptions.keyedByPath) {
      const match = /^\/mcp\/([^/]+)\/([a-z0-9_]+)\/?$/i.exec(path)
      return match ? { key: decodeURIComponent(match[1]!), namespace: match[2]! } : null
    }
    const match = /^\/mcp\/([a-z0-9_]+)\/?$/i.exec(path)
    return match ? { key: null, namespace: match[1]! } : null
  }

  /**
   * One MCP server per transport session (the SDK allows one transport per server), built from
   * the namespace's live tools. `pathKey` is the caller when the route carries one; otherwise the
   * key is read off each call's `_meta`, so it is resolved per call rather than per session.
   */
  private createSession(namespaceName: string, pathKey: string | null): Session {
    const namespace = this.registry.enabledNamespaces().find((entry) => entry.name === namespaceName)
    const server = new McpServer({ name: namespaceName, version: '0.1.0' }, { instructions: namespace?.description ?? '' })
    for (const tool of namespace?.tools ?? []) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: zodShapeFromJsonSchema(tool.inputSchema).shape },
        async (args, extra) => {
          const key = pathKey ?? this.bridgeOptions.keyFromMeta?.(extra) ?? null
          const context = this.contextFor(key)
          const callId = randomUUID()
          const result = await this.registry.call(
            { namespace: namespaceName, tool: tool.name, arguments: args as Record<string, unknown> },
            { paneId: context.paneId, threadId: context.threadId, turnId: context.turnId, callId }
          )
          if (key) this.recordCall(key, { namespace: namespaceName, tool: tool.name, callId })
          return mcpToolResult(result)
        }
      )
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { this.sessions.set(id, { transport, server }) }
    })
    transport.onclose = () => { if (transport.sessionId) this.sessions.delete(transport.sessionId) }
    return { transport, server }
  }

  private contextFor(key: string | null): McpCallContext {
    const bound = key ? this.bindings.get(key) : undefined
    if (bound) return bound
    // A call before the binding landed: the one pane with a turn running is the caller.
    const active = [...this.bindings.values()].filter((context) => context.turnId)
    return active.length === 1 ? active[0]! : { paneId: null, threadId: null, turnId: null }
  }

  private recordCall(key: string, call: ServedCall): void {
    const calls = this.ledger.get(key) ?? []
    calls.push(call)
    if (calls.length > MAX_LEDGER) calls.splice(0, calls.length - MAX_LEDGER)
    this.ledger.set(key, calls)
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}
