import { readFile, rename } from 'node:fs/promises'
import { writeAtomic } from '../atomic-write.js'
import { McpHttpBridge, type McpCallContext } from '../tools/mcp-http-bridge.js'
import type { ToolRegistry } from '../tools/registry.js'
import { toolAdvertisedEager } from '../tools/slice-tool-registry.js'
import { ANTIGRAVITY_MCP_CONFIG_PATH } from './antigravity-cli.js'

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
// - Registration is global, in `~/.gemini/config/mcp_config.json`; there is no per-spawn flag.
//   `agy mcp add --type http` writes exactly `{serverUrl}` under the server name and `mcp enable`
//   leaves the entry without a disabled flag, so the app writes those entries itself: one file
//   rewrite instead of two `agy` processes per namespace (sixteen spawns, each a second or more
//   of CPU, which was most of what switching to Antigravity cost). The eager map
//   (`tools: {<name>: {eager: true}}`, which turns a tool into a direct declaration instead of
//   hiding it behind the generic call_mcp_tool gateway) goes into the same write.
// - Each tools/call carries `_meta['antigravity.google/conversation_id']`; the service binds
//   conversation ids to its pane and turn, which becomes the registry's call context. Because
//   registration is global there is no per-session URL that could carry that key instead — which
//   is what the Cursor lane uses the same bridge's path-keyed routing for.
// - The config is one file for every app instance. The default profile registers bare namespace
//   names; any other profile (a second checkout, a test run) suffixes a stable hash so it never
//   redirects the user's running app at its own bridge.
// - Every instance read-modify-writes that shared file, and headless runs get killed. A plain
//   truncating write killed mid-flight left it at zero bytes (2026-09-23), after which every
//   launch failed to parse it and ran Antigravity with no ClosedAI tools. Writes are atomic, an
//   empty file reads as empty config, an unparseable one is moved aside, and the registration is
//   re-asserted before every CLI spawn so an entry another instance dropped heals on the next turn.

export type AntigravityServer = { server: string; namespace: string }

export type AntigravityCallContext = McpCallContext

const CONVERSATION_META = 'antigravity.google/conversation_id'

export class AntigravityToolBridge extends McpHttpBridge {
  private registered: string[] = []
  private writes: Promise<unknown> = Promise.resolve()
  /** When set, controls which tools are declared eager in the CLI config; calls use the live registry. */
  private advertisement: ToolRegistry | null = null

  constructor(
    registry: ToolRegistry,
    private readonly options: { configPath?: string; profileKey?: string | null; version?: string } = {}
  ) {
    super(registry, { label: 'antigravity', keyedByPath: false, keyFromMeta: conversationIdOf, version: options.version })
  }

  /** The MCP server name a namespace is registered under for this profile. */
  serverName(namespace: string): string {
    return this.options.profileKey ? `${namespace}_${this.options.profileKey}` : namespace
  }

  /** Servers the CLI was pointed at (empty before the first start), with the namespace each serves. */
  servers(): AntigravityServer[] {
    return this.registered.map((namespace) => ({ server: this.serverName(namespace), namespace }))
  }

  setToolAdvertisement(registry: ToolRegistry | null): void {
    this.advertisement = registry
  }

  /** Drop the app's entries from the CLI config and close the server. */
  override async stop(): Promise<void> {
    const names = this.registered
    this.registered = []
    await this.rewriteConfig((servers) => { for (const name of names) delete servers[this.serverName(name)] })
    await super.stop()
  }

  /**
   * Make sure the CLI config points at this bridge. Called before each spawn, because the CLI
   * reads the file only at process start and other instances edit it too. A no-op read when the
   * entries are already current.
   */
  async ensureRegistered(): Promise<void> {
    if (this.listening) await this.register()
  }

  /** Once the port is known, point the CLI at every enabled namespace with one config write. */
  protected override onListening(): Promise<void> {
    return this.register()
  }

  private async register(): Promise<void> {
    const endpoints = this.endpoints()
    const namespaces = new Map(this.registry.enabledNamespaces().map((namespace) => [namespace.name, namespace]))
    const written = await this.rewriteConfig((servers) => {
      for (const endpoint of endpoints) {
        const main = namespaces.get(endpoint.namespace)
        const tools = main?.tools.filter((tool) => toolAdvertisedEager(this.advertisement, endpoint.namespace, tool)) ?? []
        servers[this.serverName(endpoint.namespace)] = {
          serverUrl: endpoint.url,
          tools: Object.fromEntries(tools.map((tool) => [tool.name, { eager: true }]))
        }
      }
    })
    this.registered = written ? endpoints.map((endpoint) => endpoint.namespace) : []
    if (!written) console.warn('[antigravity] could not register the tool namespaces with agy')
  }

  /**
   * Apply an idempotent edit to the CLI's config file, creating it when the CLI has never written
   * one. The CLI does not rewrite it on exit (verified: an entry removed while a chat process ran
   * stayed removed), so this is safe once no `mcp` verb is running. Writes are serialized within
   * this bridge; across instances the edit is re-checked after the write and re-applied if a
   * concurrent writer replaced the file in between. Returns whether the edit is on disk.
   */
  private rewriteConfig(edit: (servers: Record<string, Record<string, unknown>>) => void): Promise<boolean> {
    const run = this.writes.then(() => this.applyEdit(edit))
    this.writes = run.catch(() => false)
    return run
  }

  private async applyEdit(edit: (servers: Record<string, Record<string, unknown>>) => void): Promise<boolean> {
    const path = this.options.configPath ?? ANTIGRAVITY_MCP_CONFIG_PATH
    try {
      for (let attempt = 0; ; attempt += 1) {
        const { config, raw } = await readConfig(path)
        const servers = config.mcpServers ?? {}
        edit(servers)
        const next = `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`
        if (next === raw) return true
        if (attempt === WRITE_ATTEMPTS) return false
        await writeAtomic(path, next)
      }
    } catch (error) {
      console.warn('[antigravity] could not update the agy MCP config:', error instanceof Error ? error.message : error)
      return false
    }
  }
}

type McpConfig = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>

const WRITE_ATTEMPTS = 3

/**
 * The config and its exact text (null when missing or unusable, so any edit writes). A zero-byte
 * file is what an interrupted truncating write leaves and is read as empty; text that does not
 * parse to an object is moved aside, not overwritten, so nothing the user wrote is lost.
 */
async function readConfig(path: string): Promise<{ config: McpConfig; raw: string | null }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: {}, raw: null }
    throw error
  }
  if (!raw.trim()) return { config: {}, raw: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return { config: parsed as McpConfig, raw }
  } catch {
    // Fall through: moved aside below.
  }
  const aside = `${path}.corrupt-${Date.now()}`
  await rename(path, aside)
  console.warn(`[antigravity] agy MCP config was not valid JSON; moved it to ${aside}`)
  return { config: {}, raw: null }
}

function conversationIdOf(extra: unknown): string | null {
  const meta = extra !== null && typeof extra === 'object' ? (extra as { _meta?: unknown })._meta : null
  const id = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>)[CONVERSATION_META] : null
  return typeof id === 'string' && id ? id : null
}
