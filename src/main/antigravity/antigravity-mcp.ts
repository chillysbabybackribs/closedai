import { readFile, writeFile } from 'node:fs/promises'
import { McpHttpBridge, type McpCallContext } from '../tools/mcp-http-bridge.js'
import type { ToolRegistry } from '../tools/registry.js'
import { ANTIGRAVITY_MCP_CONFIG_PATH, runAntigravityCommand } from './antigravity-cli.js'

// Adapter between the ToolRegistry and the Antigravity CLI. `agy` is a separate process, so the
// registry is served over MCP on localhost by the shared HTTP bridge: one streamable-HTTP
// endpoint per enabled namespace (`/mcp/<namespace>`), registered in the CLI's global MCP config
// under the namespace's name so the model sees `mcp_embedded_browser_page` where Claude sees
// `mcp__embedded_browser__page`. Every call runs through the SAME registry (validation, timeouts,
// telemetry, the Tools modal). What is Antigravity's own — and all this file holds — is the CLI
// registration, the config-file rewriting, and reading a call's conversation id off its `_meta`.
//
// Verified live against agy 1.1.24 and SDK 1.30 (2026-09-02):
// - The CLI POSTs `initialize` and then opens a standalone GET SSE stream, so the transport
//   must be stateful (one per mcp-session-id); it also probes /.well-known/oauth-* (404 is fine).
// - Registration is global and only through `agy mcp add/enable/remove`; there is no per-spawn
//   flag. `mcp add` writes `{serverUrl}` and drops any per-tool flags, so the eager map
//   (`tools: {<name>: {eager: true}}`, which turns a tool into a direct declaration instead of
//   hiding it behind the generic call_mcp_tool gateway) is restored by rewriting the file after.
// - Each tools/call carries `_meta['antigravity.google/conversation_id']`; the service binds
//   conversation ids to its pane and turn, which becomes the registry's call context. Because
//   registration is global there is no per-session URL that could carry that key instead — which
//   is what the Cursor lane uses the same bridge's path-keyed routing for.
// - The config is one file for every app instance. The default profile registers bare namespace
//   names; any other profile (a second checkout, a test run) suffixes a stable hash so it never
//   redirects the user's running app at its own bridge.

export type AntigravityServer = { server: string; namespace: string }

export type AntigravityCallContext = McpCallContext

const CONVERSATION_META = 'antigravity.google/conversation_id'

export class AntigravityToolBridge extends McpHttpBridge {
  private registered: string[] = []

  constructor(
    registry: ToolRegistry,
    private readonly options: { configPath?: string; binary?: string; profileKey?: string | null } = {}
  ) {
    super(registry, { label: 'antigravity', keyedByPath: false, keyFromMeta: conversationIdOf })
  }

  /** The MCP server name a namespace is registered under for this profile. */
  serverName(namespace: string): string {
    return this.options.profileKey ? `${namespace}_${this.options.profileKey}` : namespace
  }

  /** Servers the CLI was pointed at (empty before the first start), with the namespace each serves. */
  servers(): AntigravityServer[] {
    return this.registered.map((namespace) => ({ server: this.serverName(namespace), namespace }))
  }

  /** Drop the app's entries from the CLI config and close the server. */
  override async stop(): Promise<void> {
    const names = this.registered
    this.registered = []
    await this.rewriteConfig((servers) => { for (const name of names) delete servers[this.serverName(name)] })
    await super.stop()
  }

  /** Once the port is known, point the CLI at every enabled namespace. */
  protected override async onListening(): Promise<void> {
    const registered: string[] = []
    for (const endpoint of this.endpoints()) {
      const server = this.serverName(endpoint.namespace)
      if (await this.cli(['mcp', 'add', '--type', 'http', server, endpoint.url]) && await this.cli(['mcp', 'enable', server])) {
        registered.push(endpoint.namespace)
      } else {
        console.warn(`[antigravity] could not register tool namespace ${endpoint.namespace} with agy`)
      }
    }
    this.registered = registered
    await this.exposeEagerTools()
  }

  /** `agy mcp add` drops per-tool flags; put the eager map back so tools are direct declarations. */
  private exposeEagerTools(): Promise<void> {
    const namespaces = this.registry.enabledNamespaces().filter((namespace) => this.registered.includes(namespace.name))
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
}

function conversationIdOf(extra: unknown): string | null {
  const meta = extra !== null && typeof extra === 'object' ? (extra as { _meta?: unknown })._meta : null
  const id = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>)[CONVERSATION_META] : null
  return typeof id === 'string' && id ? id : null
}
