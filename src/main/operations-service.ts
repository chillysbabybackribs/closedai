import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
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
    && typeof run.checkpoint === 'string'
    && typeof run.status === 'string' && RUN_STATUSES.has(run.status as RunStatus)
    && typeof run.runtime === 'string' && typeof run.activity === 'string'
}

export class OperationsService extends EventEmitter {
  private constructor(
    private readonly filePath: string,
    private readonly modelCatalog: () => Promise<OperationsModelCatalog>,
    private runs: OperationsRun[]
  ) {
    super()
  }

  static async open(
    filePath: string,
    modelCatalog: () => Promise<OperationsModelCatalog>
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
    return new OperationsService(filePath, modelCatalog, runs)
  }

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
      checkpoint: 'Queued for initialization',
      status: 'queued',
      runtime: '—',
      activity: 'Now'
    }
    this.runs = [run, ...this.runs]
    await this.persistAndEmit()
    return { ...run }
  }

  async setStatus(id: number, status: RunStatus): Promise<void> {
    if (!Number.isFinite(id) || !RUN_STATUSES.has(status)) throw new Error('Invalid run status update')
    const current = this.runs.find((run) => run.id === id)
    if (!current) throw new Error('Run not found')
    const checkpoint = status === 'paused'
      ? 'Paused by operator'
      : status === 'queued'
        ? 'Queued to rerun'
        : status === 'failed'
          ? 'Stopped by operator'
          : current.checkpoint
    this.runs = this.runs.map((run) => run.id === id ? { ...run, status, checkpoint } : run)
    await this.persistAndEmit()
  }

  private async persistAndEmit(): Promise<void> {
    await writeAtomic(this.filePath, `${JSON.stringify(this.runs, null, 2)}\n`)
    const event: OperationsEvent = { type: 'runs', runs: this.runs.map((run) => ({ ...run })) }
    this.emit('changed', event)
  }
}
