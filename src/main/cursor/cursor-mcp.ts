import { McpHttpBridge } from '../tools/mcp-http-bridge.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { AcpMcpServer } from './cursor-acp.js'

// Adapter between the ToolRegistry and the Cursor ACP server. `cursor-agent` is a separate
// process, so the registry is served over MCP on localhost by the shared HTTP bridge — but where
// the `agy` CLI needs its servers written into one global config file, ACP takes them as a
// `session/new` parameter (`agentCapabilities.mcpCapabilities.http` is true, verified live on
// 2026-09-03). That has two consequences worth stating, because they are why this file is short:
//
// - Nothing outside the app is mutated. No config file to rewrite on start and clean up on stop,
//   and no profile-key hashing to keep a second checkout from redirecting the user's running app.
// - Each pane's endpoints carry its own key in the URL (`/mcp/<key>/<namespace>`), so a served
//   call names its caller exactly, with no `_meta` sniffing and no guessing when two panes run
//   turns at once.

export class CursorToolBridge extends McpHttpBridge {
  constructor(registry: ToolRegistry) {
    super(registry, { label: 'cursor', keyedByPath: true })
  }

  /** The `session/new` server list for one pane, addressed by that pane's bridge key. */
  servers(key: string): AcpMcpServer[] {
    return this.endpoints(key).map((endpoint) => ({
      type: 'http',
      name: endpoint.namespace,
      url: endpoint.url
    }))
  }
}
