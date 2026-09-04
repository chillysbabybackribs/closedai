import {
  StdioJsonRpcClient,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type RpcId
} from './stdio-json-rpc.js'
import type { TraceScope } from './trace/trace-log.js'
import { summarizeCodexRpc } from './trace/summaries.js'

// The Codex app-server: `codex app-server --listen stdio://`, driven over newline-delimited
// JSON-RPC. The framing, pending-request table, and trace tap are the shared stdio client;
// what is Codex's own is the spawn arguments and the `initialize`/`initialized` handshake.

export type { RpcId }
export type AppServerNotification = JsonRpcNotification
export type AppServerRequest = JsonRpcRequest

export class AppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly data: unknown
  ) {
    super(message)
    this.name = 'AppServerRpcError'
  }
}

export class AppServerClient extends StdioJsonRpcClient {
  constructor(
    executable: string,
    cwd: string,
    /** Extra `codex app-server` arguments, read at each spawn so a restart picks up changes. */
    launchArgs: () => string[] = () => [],
    /** When set, every line in either direction is recorded in the turn trace under this scope. */
    traceScope: (() => TraceScope) | null = null
  ) {
    super({
      peer: 'Codex app-server',
      executable,
      cwd,
      args: () => ['app-server', ...launchArgs(), '--listen', 'stdio://'],
      trace: traceScope
        ? {
            scope: traceScope,
            label: (direction) => (direction === 'in' ? 'codex.in' : 'codex.out'),
            summarize: summarizeCodexRpc
          }
        : null
    })
  }

  override async start(): Promise<void> {
    if (this.connected) return
    await super.start()
    try {
      await this.request('initialize', {
        clientInfo: { name: 'closedai', title: 'ClosedAI', version: '0.1.0' },
        capabilities: {
          // Opts in to experimental fields such as thread/start `dynamicTools` (tools/).
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: []
        }
      })
      this.notify('initialized', {})
    } catch (error) {
      this.stop()
      throw error
    }
  }

  /** Kept so a failure surfaced in the renderer still names itself `AppServerRpcError`. */
  protected override rpcError(message: string, code: number | null, data: unknown): Error {
    return new AppServerRpcError(message, code, data)
  }
}
