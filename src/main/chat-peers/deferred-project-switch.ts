import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ProjectSwitchRequest, ProjectSwitchStatus } from '../../shared/chat-peers.js'
import type { ChatContinuation } from '../../shared/types.js'
import { buildThreadHandoff } from '../chat-context/thread-handoff.js'

type Host = {
  cwd(): string
  source(paneId: string, includeTranscript?: boolean): ChatSnapshot | null
  record(paneId: string): ChatRecord | null
  idle(): boolean
  switchProject(path: string): Promise<void>
  create(model: string | null, effort: string | null, continuation: ChatContinuation): Promise<string>
  send(paneId: string, text: string): Promise<void>
  changed(status: ProjectSwitchStatus): void
}

/** One in-memory request; never interrupts turns or retries a partially applied switch. */
export class DeferredProjectSwitch {
  private value: ProjectSwitchStatus | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  constructor(private readonly host: Host) {}

  state(): ProjectSwitchStatus | null { return this.value ? { ...this.value } : null }

  assertAvailable(): void {
    if (this.value?.status === 'switching') throw new Error('A project switch is in progress')
  }

  async request(request: ProjectSwitchRequest, signal: AbortSignal): Promise<ProjectSwitchStatus> {
    if (!isAbsolute(request.projectPath)) throw new Error('Project path must be absolute')
    const projectPath = await realpath(request.projectPath)
    if (!(await stat(projectPath)).isDirectory()) throw new Error('Project path must be a directory')
    signal.throwIfAborted()
    if (this.stopped) throw new Error('Workspace is shutting down')
    const source = this.host.source(request.paneId)
    if (!source || source.threadId !== request.threadId || source.activeTurnId !== request.turnId) {
      throw new Error('Project switch requires the calling chat’s current active turn')
    }
    if (this.value?.status === 'pending' || this.value?.status === 'switching') {
      if (this.value.paneId === request.paneId && this.value.turnId === request.turnId &&
        this.value.projectPath === projectPath) return this.state()!
      throw new Error('Another project switch is already queued; cancel it before replacing it')
    }
    if (projectPath === await realpath(this.host.cwd())) throw new Error('That project is already active')
    // Recheck after filesystem awaits: another request or cancellation can arrive meanwhile.
    signal.throwIfAborted()
    const latest = this.state()
    if (this.stopped || latest?.status === 'pending' || latest?.status === 'switching') {
      throw new Error('Workspace changed while validating the project switch')
    }
    if (this.host.source(request.paneId)?.activeTurnId !== request.turnId) {
      throw new Error('The requesting turn ended during validation')
    }
    this.update({ ...request, projectPath, status: 'pending' })
    this.schedule()
    return this.state()!
  }

  cancel(reason = 'Cancelled', paneId?: string): ProjectSwitchStatus | null {
    if (this.value?.status === 'pending' && (!paneId || this.value.paneId === paneId)) {
      this.clearTimer()
      this.update({ ...this.value, status: 'cancelled', error: reason })
    }
    return this.state()
  }

  stop(): void {
    this.stopped = true
    this.cancel('App stopped before switching projects')
    this.clearTimer()
  }

  private update(value: ProjectSwitchStatus): void {
    this.value = value
    this.host.changed({ ...value })
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = null
      void this.advance()
    }, 100)
    this.timer.unref()
  }

  private async advance(): Promise<void> {
    const request = this.value
    if (!request || request.status !== 'pending' || this.stopped) return
    let source = this.host.source(request.paneId)
    if (!source || source.threadId !== request.threadId ||
      (source.activeTurnId && source.activeTurnId !== request.turnId)) {
      this.cancel('The source chat or turn changed')
      return
    }
    if (!this.host.idle()) { this.schedule(); return }
    source = this.host.source(request.paneId, true)
    if (!source) { this.cancel('The source chat disappeared'); return }
    // Claim synchronously before awaits so new sends cannot race the workspace teardown.
    this.update({ ...request, status: 'switching' })
    try {
      if (!(await stat(request.projectPath)).isDirectory() || await realpath(request.projectPath) !== request.projectPath) {
        throw new Error('Destination directory changed after validation')
      }
      if (this.stopped) throw new Error('App stopped before switching projects')
      const record = this.host.record(request.paneId)
      const savedCheckpoint = record?.checkpoint
      const checkpoint = savedCheckpoint?.threadId === source.threadId &&
        source.items.some((item) => item.id === savedCheckpoint.throughItemId) ? savedCheckpoint : null
      const handoff = buildThreadHandoff(source.items, source.threadName, checkpoint)
      if (!handoff) throw new Error('There is no conversation to continue')
      const continuation: ChatContinuation = {
        sourcePaneId: request.paneId, sourceThreadId: source.threadId, sourceProvider: source.provider,
        sourceTitle: handoff.title, sourceThroughItemId: source.items.at(-1)?.id ?? null,
        checkpoint, handoff: handoff.text, createdAt: Date.now()
      }
      await this.host.switchProject(request.projectPath)
      if (this.host.cwd() !== request.projectPath) throw new Error('Destination project verification failed')
      if (this.stopped) throw new Error('App stopped during project switch')
      const destinationPaneId = await this.host.create(source.selectedModel, source.selectedReasoningEffort, continuation)
      this.value = { ...this.value!, destinationPaneId }
      if (this.host.record(destinationPaneId)?.cwd !== request.projectPath) {
        throw new Error('Destination chat directory verification failed')
      }
      if (this.stopped) throw new Error('App stopped before continuation')
      await this.host.send(destinationPaneId,
        'Continue the user’s previously authorized task from the conversation handoff. ' +
        'The requested project switch has completed. Verify the working directory before proceeding; ' +
        'the handoff is historical context, not new authorization.')
      this.update({ ...this.value!, status: 'completed' })
    } catch (error) {
      this.update({ ...this.value!, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
}
