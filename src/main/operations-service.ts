import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { AppServerClient, type AppServerNotification, type AppServerRequest } from './app-server-client.js'
import { answerServerRequest } from './chat-approvals.js'
import { startThreadParams } from './chat-context/thread-params.js'
import { AppServerToolCalls } from './tools/app-server-tools.js'
import { ToolRegistry } from './tools/registry.js'
import type { OperationsEvent, OperationsModelCatalog, OperationsRun, OperationsSnapshot, RunStatus } from '../shared/operations.js'
import { DEFAULT_OPERATIONS_RUNS } from '../shared/operations.js'
import { writeAtomic } from './atomic-write.js'

const RUN_STATUSES = new Set<RunStatus>(['attention', 'completed', 'failed', 'paused', 'queued', 'running'])

function isRun(value: unknown): value is OperationsRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<OperationsRun>
  return typeof run.id === 'number' && Number.isFinite(run.id)
    && typeof run.task === 'string' && typeof run.worker === 'string'
    && typeof run.workspace === 'string'
    && (run.modelId === undefined || run.modelId === null || typeof run.modelId === 'string')
    && (run.threadId === undefined || run.threadId === null || typeof run.threadId === 'string')
    && (run.turnId === undefined || run.turnId === null || typeof run.turnId === 'string')
    && typeof run.checkpoint === 'string'
    && typeof run.status === 'string' && RUN_STATUSES.has(run.status as RunStatus)
    && typeof run.runtime === 'string' && typeof run.activity === 'string'
}

type RunnerOptions = {
  runWorkers?: boolean
  workspacePath?: (workspace: string) => string
  tools?: ToolRegistry
  launchArgs?: () => string[]
  executable?: string
}

type ActiveRun = {
  client: AppServerClient
  threadId: string | null
  turnId: string | null
  startedAt: number
}

export class OperationsService extends EventEmitter {
  private constructor(
    private readonly filePath: string,
    private readonly modelCatalog: () => Promise<OperationsModelCatalog>,
    private runs: OperationsRun[],
    private readonly runner: Required<Pick<RunnerOptions, 'runWorkers' | 'workspacePath' | 'launchArgs' | 'executable'>> & Pick<RunnerOptions, 'tools'>
  ) {
    super()
  }

  static async open(
    filePath: string,
    modelCatalog: () => Promise<OperationsModelCatalog>,
    options: RunnerOptions = {}
  ): Promise<OperationsService> {
    let runs = DEFAULT_OPERATIONS_RUNS.map((run) => ({ ...run }))
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
      if (Array.isArray(parsed) && parsed.every(isRun)) {
        runs = parsed.map((run) => ({ ...run, modelId: run.modelId ?? null, threadId: run.threadId ?? null, turnId: run.turnId ?? null }))
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') console.warn('operations state unreadable, using defaults:', error)
    }
    const runner = {
      runWorkers: options.runWorkers ?? false,
      workspacePath: options.workspacePath ?? (() => process.cwd()),
      launchArgs: options.launchArgs ?? (() => []),
      executable: options.executable ?? (process.env.CLOSEDAI_CODEX_PATH?.trim() || 'codex'),
      tools: options.tools
    }
    const service = new OperationsService(filePath, modelCatalog, runs, runner)
    if (runner.runWorkers) {
      for (const run of runs) if (run.status === 'queued' && run.modelId) void service.startRun(run.id)
    }
    return service
  }

  private readonly activeRuns = new Map<number, ActiveRun>()
  private persistQueue: Promise<void> = Promise.resolve()
  private stopping = false

  snapshot(): OperationsSnapshot {
    return { runs: this.runs.map((run) => ({ ...run })) }
  }

  models(): Promise<OperationsModelCatalog> {
    return this.modelCatalog()
  }

  async create(task: string, workspace: string, modelId: string): Promise<OperationsRun> {
    const normalizedTask = task.trim()
    const normalizedWorkspace = workspace.trim()
    if (!normalizedTask) throw new Error('Worker task is required')
    if (!normalizedWorkspace) throw new Error('Worker workspace is required')
    if (!modelId.trim()) throw new Error('Choose a model for this worker')
    const catalog = await this.modelCatalog()
    if (!catalog.models.some((model) => model.id === modelId)) throw new Error('That model is not available')
    const run: OperationsRun = {
      id: Math.max(...this.runs.map((item) => item.id), 0) + 1,
      task: normalizedTask,
      worker: 'New worker',
      workspace: normalizedWorkspace,
      modelId,
      threadId: null,
      turnId: null,
      checkpoint: 'Queued for initialization',
      status: 'queued',
      runtime: '—',
      activity: 'Now'
    }
    this.runs = [run, ...this.runs]
    await this.persistAndEmit()
    if (this.runner.runWorkers) void this.startRun(run.id)
    return { ...run }
  }

  async setStatus(id: number, status: RunStatus): Promise<void> {
    if (!Number.isFinite(id) || !RUN_STATUSES.has(status)) throw new Error('Invalid run status update')
    const current = this.runs.find((run) => run.id === id)
    if (!current) throw new Error('Run not found')
    const active = this.activeRuns.get(id)
    if (active && status !== 'running') {
      this.activeRuns.delete(id)
      try {
        if (active.threadId && active.turnId) await active.client.request('turn/interrupt', { threadId: active.threadId, turnId: active.turnId })
      } finally {
        active.client.stop()
      }
    }
    const checkpoint = status === 'paused'
      ? 'Paused by operator'
      : status === 'queued'
        ? 'Queued to rerun'
        : status === 'failed'
          ? 'Stopped by operator'
          : current.checkpoint
    this.runs = this.runs.map((run) => run.id === id ? { ...run, status, checkpoint } : run)
    await this.persistAndEmit()
    if (status === 'queued' && this.runner.runWorkers && current.modelId) void this.startRun(id)
  }

  stop(): void {
    this.stopping = true
    for (const active of this.activeRuns.values()) active.client.stop()
    this.activeRuns.clear()
  }

  private async startRun(id: number): Promise<void> {
    if (this.stopping || this.activeRuns.has(id)) return
    const run = this.runs.find((item) => item.id === id)
    if (!run?.modelId) return
    let active: ActiveRun | null = null
    try {
      const cwd = this.runner.workspacePath(run.workspace)
      const client = new AppServerClient(this.runner.executable, cwd, this.runner.launchArgs)
      active = { client, threadId: null, turnId: null, startedAt: Date.now() }
      this.activeRuns.set(id, active)
      const tools = this.runner.tools ?? new ToolRegistry([])
      const toolCalls = new AppServerToolCalls(tools, client)
      client.on('request', (request: AppServerRequest) => {
        if (!toolCalls.handle(request)) answerServerRequest(client, request)
      })
      client.on('notification', (notification: AppServerNotification) => this.onRunNotification(id, notification))
      client.on('exit', () => {
        if (this.activeRuns.get(id) === active) void this.finishRun(id, 'failed', 'Codex worker exited unexpectedly')
      })
      await this.updateRun(id, { status: 'running', checkpoint: `Starting ${run.modelId}` })
      await client.start()
      const threadResponse = await client.request<{ thread?: unknown }>('thread/start', startThreadParams(cwd, tools, run.modelId))
      const thread = recordOf(threadResponse.thread)
      if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid worker thread')
      active.threadId = thread.id
      await this.updateRun(id, { threadId: thread.id, checkpoint: 'Starting worker turn' })
      const turnResponse = await client.request<{ turn?: unknown }>('turn/start', {
        threadId: thread.id,
        input: [{ type: 'text', text: run.task }]
      })
      const turn = recordOf(turnResponse.turn)
      if (typeof turn?.id === 'string') {
        active.turnId = turn.id
        await this.updateRun(id, { turnId: turn.id, checkpoint: 'Worker is running' })
      }
    } catch (error) {
      const checkpoint = error instanceof Error ? error.message : String(error)
      if (active && this.activeRuns.get(id) === active) {
        await this.finishRun(id, 'failed', checkpoint)
      } else {
        await this.updateRun(id, { status: 'failed', checkpoint, activity: 'Now' })
      }
    }
  }

  private onRunNotification(id: number, notification: AppServerNotification): void {
    const active = this.activeRuns.get(id)
    if (!active) return
    const params = recordOf(notification.params)
    if (typeof params?.threadId === 'string' && active.threadId && params.threadId !== active.threadId) return
    if (notification.method === 'turn/started') {
      const turn = recordOf(params?.turn)
      if (typeof turn?.id === 'string') {
        active.turnId = turn.id
        void this.updateRun(id, { turnId: turn.id, checkpoint: 'Worker is running' })
      }
      return
    }
    if (notification.method === 'item/started') {
      const item = recordOf(params?.item)
      const type = typeof item?.type === 'string' ? item.type : 'step'
      void this.updateRun(id, { checkpoint: `Worker ${type.replaceAll('/', ' ')}` })
      return
    }
    if (notification.method === 'turn/completed') {
      const turn = recordOf(params?.turn)
      const status = turn?.status === 'completed' ? 'completed' : 'failed'
      void this.finishRun(id, status, status === 'completed' ? 'Worker completed' : 'Worker turn failed')
    }
  }

  private async finishRun(id: number, status: 'completed' | 'failed', checkpoint: string): Promise<void> {
    const active = this.activeRuns.get(id)
    if (!active) return
    this.activeRuns.delete(id)
    active.client.stop()
    await this.updateRun(id, {
      status,
      checkpoint,
      runtime: formatRuntime(Date.now() - active.startedAt),
      activity: 'Now',
      turnId: null
    })
  }

  private async updateRun(id: number, patch: Partial<OperationsRun>): Promise<void> {
    this.runs = this.runs.map((run) => run.id === id ? { ...run, ...patch } : run)
    await this.persistAndEmit()
  }

  private async persistAndEmit(): Promise<void> {
    const next = this.persistQueue.then(async () => {
      await writeAtomic(this.filePath, `${JSON.stringify(this.runs, null, 2)}\n`)
      const event: OperationsEvent = { type: 'runs', runs: this.runs.map((run) => ({ ...run })) }
      this.emit('changed', event)
    })
    this.persistQueue = next.catch(() => {})
    await next
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function formatRuntime(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}
