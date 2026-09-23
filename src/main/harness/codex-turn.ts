import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppServerClient, type AppServerNotification, type AppServerRequest } from '../app-server-client.js'
import { nullableString, recordOf } from '../chat-normalizers.js'
import { codexExecutable } from '../codex-workspace-runtime.js'
import { startThreadParams } from '../chat-context/thread-params.js'
import { AppServerToolCalls } from '../tools/app-server-tools.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { RecordedToolCall } from './types.js'
import type { HarnessVariant } from './variants.js'
import { harnessDeveloperInstructions } from './variants.js'

export type CodexHarnessTurnOptions = {
  registry: ToolRegistry
  userMessage: string
  model?: string | null
  effort?: string | null
  variant?: HarnessVariant
  turnTimeoutMs?: number
  projectRoot?: string
}

export type CodexHarnessTurnResult = {
  calls: RecordedToolCall[]
  threadId: string | null
  turnStatus: string | null
}

const DEFAULT_TURN_TIMEOUT_MS = 180_000

export async function runCodexHarnessTurn(options: CodexHarnessTurnOptions): Promise<CodexHarnessTurnResult> {
  const cwd = options.projectRoot ?? await mkdtemp(join(tmpdir(), 'closedai-harness-'))
  const ownsCwd = !options.projectRoot
  const client = new AppServerClient(codexExecutable(), cwd)
  const calls: RecordedToolCall[] = []
  options.registry.observe((trace) => {
    if (trace.phase !== 'end') return
    calls.push({
      namespace: trace.request.namespace ?? '',
      tool: trace.request.tool,
      arguments: (trace.request.arguments ?? {}) as Record<string, unknown>,
      isError: trace.result.isError,
      errorKind: trace.result.errorKind
    })
  })
  const toolHost = new AppServerToolCalls(options.registry, client, 'harness')
  let activeThreadId: string | null = null
  let turnStatus: string | null = null

  client.on('request', (request: AppServerRequest) => {
    if (toolHost.handle(request)) return
    client.respondWithError(request.id, -32601, `Harness does not handle ${request.method}`)
  })

  const turnDone = new Promise<void>((resolve, reject) => {
    const timeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
    const timer = setTimeout(() => reject(new Error(`Codex turn timed out after ${timeoutMs}ms`)), timeoutMs)
    client.on('notification', (notification: AppServerNotification) => {
      if (notification.method !== 'turn/completed') return
      const params = recordOf(notification.params)
      const threadId = nullableString(params?.threadId)
      if (threadId && activeThreadId && threadId !== activeThreadId) return
      const turn = recordOf(params?.turn)
      turnStatus = typeof turn?.status === 'string' ? turn.status : null
      clearTimeout(timer)
      if (turnStatus === 'failed') {
        const error = recordOf(turn?.error)
        reject(new Error(typeof error?.message === 'string' ? error.message : 'Codex turn failed'))
        return
      }
      resolve()
    })
  })

  try {
    await client.start()
    const startParams = {
      ...startThreadParams(cwd, options.registry, {
        model: options.model ?? null,
        effort: options.effort ?? null
      }),
      developerInstructions: harnessDeveloperInstructions(options.variant)
    }
    const started = await client.request<{ thread?: unknown }>('thread/start', startParams, 60_000)
    const thread = recordOf(started.thread)
    activeThreadId = typeof thread?.id === 'string' ? thread.id : null
    if (!activeThreadId) throw new Error('Codex thread/start did not return a thread id')

    const clientUserMessageId = crypto.randomUUID()
    await client.request('turn/start', {
      threadId: activeThreadId,
      clientUserMessageId,
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      input: [{ type: 'text', text: options.userMessage }]
    }, 60_000)

    await turnDone
    return { calls, threadId: activeThreadId, turnStatus }
  } finally {
    client.stop()
    if (ownsCwd) await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}
