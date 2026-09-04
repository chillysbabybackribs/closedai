import { EventEmitter } from 'node:events'

import type { ChatModel } from '../shared/chat.js'
import type { AppSettingsAccess } from './app-settings-store.js'
import {
  AppServerClient,
  type AppServerNotification,
  type AppServerRequest,
  type RpcId
} from './app-server-client.js'
import { appServerConfigArgs } from './chat-context/app-server-config.js'
import { loadChatModels } from './chat-model-catalog.js'
import { loadCodexModelContextWindows } from './codex-model-context.js'
import type { TraceScope } from './trace/trace-log.js'
import { nonEmptyString, recordOf } from './json-coerce.js'

export type RuntimeSessionState = {
  account: unknown
  requiresOpenaiAuth: boolean
  models: ChatModel[]
}

type RuntimeTarget = {
  session: CodexRuntimeSession
  paneId: string | null
  threadId: () => string | null
  turnId: () => string | null
}

export type CodexRuntimeTransport = EventEmitter & Pick<
  AppServerClient,
  'start' | 'stop' | 'request' | 'respond' | 'respondWithError'
>

/** One pane's scoped view of the workspace-owned Codex transport. */
export class CodexRuntimeSession extends EventEmitter {
  private active = false

  constructor(
    private readonly runtime: CodexWorkspaceRuntime,
    readonly paneId: string | null,
    private readonly currentThreadId: () => string | null,
    private readonly currentTurnId: () => string | null
  ) {
    super()
  }

  start(): Promise<void> {
    if (!this.active) {
      this.active = true
      this.runtime.activate(this.target())
    }
    return this.runtime.start()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.runtime.deactivate(this)
  }

  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.active) {
      this.active = true
      this.runtime.activate(this.target())
    }
    return this.runtime.request<T>(this.scope(), method, params, timeoutMs)
  }

  respond(id: RpcId, result: unknown): void {
    this.runtime.respond(this.scope(), id, result)
  }

  respondWithError(id: RpcId, code: number, message: string): void {
    this.runtime.respondWithError(this.scope(), id, code, message)
  }

  readSession(refresh = false): Promise<RuntimeSessionState> {
    return this.runtime.readSession(refresh)
  }

  private target(): RuntimeTarget {
    return {
      session: this,
      paneId: this.paneId,
      threadId: this.currentThreadId,
      turnId: this.currentTurnId
    }
  }

  private scope(): TraceScope {
    return { paneId: this.paneId, provider: 'codex', turnId: this.currentTurnId() }
  }
}

/**
 * One Codex app-server per workspace. Panes keep independent thread/transcript state and receive
 * only events whose thread or turn they own; account-level events are shared by every active pane.
 */
export class CodexWorkspaceRuntime {
  private readonly transport: CodexRuntimeTransport
  private readonly targets = new Map<CodexRuntimeSession, RuntimeTarget>()
  private startPromise: Promise<void> | null = null
  private sessionPromise: Promise<RuntimeSessionState> | null = null
  private sessionState: RuntimeSessionState | null = null

  constructor(
    readonly cwd: string,
    settings: AppSettingsAccess,
    executable = process.env.CLOSEDAI_CODEX_PATH?.trim() || 'codex',
    transport?: CodexRuntimeTransport
  ) {
    this.transport = transport ?? new AppServerClient(
      executable,
      cwd,
      () => appServerConfigArgs(settings.get()),
      (_direction, message) => this.scopeFor(message)
    )
    this.transport.on('notification', (notification: AppServerNotification) => this.route('notification', notification))
    this.transport.on('request', (request: AppServerRequest) => this.route('request', request))
    this.transport.on('protocolError', (error: Error) => this.broadcast('protocolError', error))
    this.transport.on('exit', (detail: unknown) => {
      this.startPromise = null
      this.sessionPromise = null
      this.sessionState = null
      this.broadcast('exit', detail)
    })
  }

  session(
    paneId: string | null,
    threadId: () => string | null,
    turnId: () => string | null
  ): CodexRuntimeSession {
    return new CodexRuntimeSession(this, paneId, threadId, turnId)
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.transport.start().catch((error: unknown) => {
      this.startPromise = null
      throw error
    })
    return this.startPromise
  }

  stop(): void {
    this.startPromise = null
    this.sessionPromise = null
    this.sessionState = null
    this.transport.stop()
  }

  activate(target: RuntimeTarget): void {
    this.targets.set(target.session, target)
  }

  deactivate(session: CodexRuntimeSession): void {
    this.targets.delete(session)
  }

  request<T>(scope: TraceScope, method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    return this.transport.request<T>(method, params, timeoutMs, scope)
  }

  respond(scope: TraceScope, id: RpcId, result: unknown): void {
    this.transport.respond(id, result, scope)
  }

  respondWithError(scope: TraceScope, id: RpcId, code: number, message: string): void {
    this.transport.respondWithError(id, code, message, scope)
  }

  async readSession(refresh = false): Promise<RuntimeSessionState> {
    if (!refresh && this.sessionState) return this.sessionState
    if (this.sessionPromise) return this.sessionPromise
    this.sessionPromise = this.loadSession().then((state) => {
      this.sessionState = state
      return state
    }).finally(() => {
      this.sessionPromise = null
    })
    return this.sessionPromise
  }

  private async loadSession(): Promise<RuntimeSessionState> {
    await this.start()
    const account = await this.transport.request<{ account?: unknown; requiresOpenaiAuth?: unknown }>(
      'account/read',
      { refreshToken: false }
    )
    let models: ChatModel[] = []
    try {
      const contextWindows = await loadCodexModelContextWindows()
      models = (await loadChatModels(this.transport, null, null, contextWindows)).models
    } catch (error) {
      console.warn('[app-server] could not list models:', error instanceof Error ? error.message : String(error))
    }
    return {
      account: account.account,
      requiresOpenaiAuth: account.requiresOpenaiAuth === true,
      models
    }
  }

  private route(event: 'notification' | 'request', message: AppServerNotification | AppServerRequest): void {
    const scope = messageScope(message)
    let targets = scope.threadId
      ? [...this.targets.values()].filter((target) => target.threadId() === scope.threadId)
      : scope.turnId
        ? [...this.targets.values()].filter((target) => target.turnId() === scope.turnId)
        : [...this.targets.values()]
    // Account notifications belong to every pane. An unscoped server request must have exactly
    // one answer, while a scoped request with no owner is failed instead of timing out.
    if (event === 'request') {
      targets = targets.slice(0, 1)
      if (targets.length === 0) {
        this.transport.respondWithError((message as AppServerRequest).id, -32603, 'No active pane owns this Codex request')
        return
      }
    }
    for (const target of targets) target.session.emit(event, message)
  }

  private broadcast(event: 'protocolError' | 'exit', detail: unknown): void {
    for (const target of this.targets.values()) target.session.emit(event, detail)
  }

  private scopeFor(message: unknown): TraceScope {
    const scope = messageScope(message)
    const target = [...this.targets.values()].find((candidate) =>
      (scope.threadId && candidate.threadId() === scope.threadId)
      || (scope.turnId && candidate.turnId() === scope.turnId))
    return { paneId: target?.paneId ?? null, provider: 'codex', turnId: scope.turnId ?? target?.turnId() ?? null }
  }
}

function messageScope(message: unknown): { threadId: string | null; turnId: string | null } {
  const record = recordOf(message)
  const params = recordOf(record?.params)
  const turn = recordOf(params?.turn)
  return {
    threadId: nonEmptyString(params?.threadId),
    turnId: nonEmptyString(params?.turnId) ?? nonEmptyString(turn?.id)
  }
}
