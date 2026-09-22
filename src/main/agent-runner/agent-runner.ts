// The run loop behind the agent workspace. It reacts to two things — the project store changing
// and a chat pane finishing a turn — and on either it asks `planRun` what should be happening,
// then makes that true: open workers, hand them one task each, settle the ones whose worker
// stopped, and ask the coordinator to plan when the queue runs dry.
//
// The loop lives here rather than in a coordinator's prompt because a chat model only acts when
// something sends it a message. Nothing sends it one when a worker finishes, so a prompt-driven
// hive stops after every task. This does not stop: it has no turn to end.

import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { ProjectMutation, ProjectTreeEvent } from '../../shared/project/mutations.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { TaskAssignment, TreeNode } from '../../shared/project/tree.js'
import { coordinatorBrief, nudgeBrief, workerBrief } from './runner-briefs.js'
import { planRun, type PaneState, type RunnerPlan } from './runner-plan.js'

/** Settling time after a change, so a burst of store writes becomes one pass. */
const SCHEDULE_DELAY_MS = 400
/** Backstop for anything that ends without an event: a killed provider, a pane that never replied. */
const SWEEP_MS = 15_000
/** Floor between two writes of the same worker's activity line, so a busy turn is not a write storm. */
const ACTIVITY_REFRESH_MS = 3_000

export type RunnerChat = {
  paneState(paneId: string): PaneState
  newWorker(parentPaneId: string): Promise<string>
  send(paneId: string, text: string): Promise<void>
  /** Subscribe to workspace events; returns the unsubscribe. */
  on(listener: (event: ChatWorkspaceEvent) => void): () => void
}

export type RunnerStore = {
  snapshot(projectPath: string): Promise<ProjectSnapshot>
  mutate(projectPath: string, mutations: readonly ProjectMutation[]): Promise<ProjectSnapshot>
  /** Subscribe to every project snapshot the hub publishes, including on open. */
  on(listener: (snapshot: ProjectSnapshot) => void): () => void
}

export type AgentRunnerDeps = {
  store: () => RunnerStore | null
  chat: () => RunnerChat | null
  now?: () => number
  warn?: (message: string) => void
}

type ProjectRun = {
  timer: NodeJS.Timeout | null
  running: boolean
  again: boolean
  /** Tree and journal shape at the last coordinator turn, so the loop never asks twice for nothing. */
  askedSignature: string | null
  /** Said once per project, so a missing coordinator does not fill the journal. */
  warnedNoCoordinator: boolean
}

export class AgentRunner {
  private readonly runs = new Map<string, ProjectRun>()
  /** Which project a pane belongs to, so a worker's turn ending wakes the right loop. */
  private readonly paneProject = new Map<string, string>()
  private unsubscribe: Array<() => void> = []
  private sweepTimer: NodeJS.Timeout | null = null
  private stopped = true

  constructor(private readonly deps: AgentRunnerDeps) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    const store = this.deps.store()
    const chat = this.deps.chat()
    if (store) {
      this.unsubscribe.push(store.on((snapshot) => {
        if (snapshot.phase === 'building') this.schedule(snapshot.projectPath)
        else this.forget(snapshot.projectPath)
      }))
    }
    if (chat) {
      this.unsubscribe.push(chat.on((event) => {
        if (event.type !== 'pane' || event.event.type !== 'turn' || event.event.turnId !== null) return
        const projectPath = this.paneProject.get(event.paneId)
        if (projectPath) this.schedule(projectPath)
      }))
    }
    this.sweepTimer = setInterval(() => {
      for (const projectPath of this.runs.keys()) this.schedule(projectPath, 0)
    }, SWEEP_MS)
    this.sweepTimer.unref?.()
  }

  stop(): void {
    this.stopped = true
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
    for (const run of this.runs.values()) if (run.timer) clearTimeout(run.timer)
    this.runs.clear()
    this.paneProject.clear()
  }

  /** Run one pass now and wait for it. Tests drive the loop with this instead of timers. */
  async runOnce(projectPath: string): Promise<void> {
    this.ensure(projectPath)
    await this.evaluate(projectPath)
  }

  private schedule(projectPath: string, delayMs = SCHEDULE_DELAY_MS): void {
    if (this.stopped) return
    const run = this.ensure(projectPath)
    if (run.running) {
      run.again = true
      return
    }
    if (run.timer) return
    run.timer = setTimeout(() => {
      run.timer = null
      void this.evaluate(projectPath)
    }, delayMs)
    run.timer.unref?.()
  }

  private ensure(projectPath: string): ProjectRun {
    let run = this.runs.get(projectPath)
    if (!run) {
      run = { timer: null, running: false, again: false, askedSignature: null, warnedNoCoordinator: false }
      this.runs.set(projectPath, run)
    }
    return run
  }

  private forget(projectPath: string): void {
    const run = this.runs.get(projectPath)
    if (!run) return
    if (run.timer) clearTimeout(run.timer)
    this.runs.delete(projectPath)
  }

  private async evaluate(projectPath: string): Promise<void> {
    const run = this.runs.get(projectPath)
    if (!run || this.stopped) return
    if (run.running) {
      run.again = true
      return
    }
    run.running = true
    try {
      do {
        run.again = false
        await this.pass(projectPath, run)
      } while (run.again && !this.stopped)
    } catch (error) {
      this.deps.warn?.(`[agent-runner] ${projectPath}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      run.running = false
    }
  }

  private async pass(projectPath: string, run: ProjectRun): Promise<void> {
    const store = this.deps.store()
    const chat = this.deps.chat()
    if (!store || !chat) return
    const snapshot = await store.snapshot(projectPath)
    if (snapshot.phase !== 'building') {
      this.forget(projectPath)
      return
    }
    const now = this.deps.now?.() ?? Date.now()
    const coordinatorPaneId = snapshot.coordinator?.paneId ?? null
    if (coordinatorPaneId) this.paneProject.set(coordinatorPaneId, projectPath)
    for (const node of snapshot.tree) {
      if (node.assignment) this.paneProject.set(node.assignment.paneId, projectPath)
    }

    const plan = planRun({ nodes: snapshot.tree, hive: snapshot.hive, now, pane: (id) => chat.paneState(id) })
    await this.refreshActivity(projectPath, plan, chat, store, now)
    await this.settle(projectPath, plan, chat, store, now)
    await this.dispatch(projectPath, snapshot, plan, chat, store, coordinatorPaneId, run, now)
    await this.askCoordinator(projectPath, snapshot, plan, chat, store, coordinatorPaneId, run)
  }

  /** Keep each running node showing what its worker is doing, without writing on every tool call. */
  private async refreshActivity(projectPath: string, plan: RunnerPlan, chat: RunnerChat, store: RunnerStore, now: number): Promise<void> {
    const events: ProjectTreeEvent[] = []
    for (const node of plan.carrying) {
      const assignment = node.assignment
      if (!assignment) continue
      const activity = chat.paneState(assignment.paneId).activity
      if (activity === assignment.activity) continue
      if (now - assignment.activityAt < ACTIVITY_REFRESH_MS) continue
      events.push({ assign: { id: node.id, assignment: { ...assignment, activity, activityAt: now } } })
    }
    if (events.length) await store.mutate(projectPath, [{ type: 'tree', events }])
  }

  private async settle(projectPath: string, plan: RunnerPlan, chat: RunnerChat, store: RunnerStore, now: number): Promise<void> {
    for (const entry of plan.settle) {
      const assignment = entry.node.assignment
      if (entry.outcome === 'nudge' && assignment) {
        const next: TaskAssignment = { ...assignment, attempts: assignment.attempts + 1, activityAt: now }
        await store.mutate(projectPath, [{
          type: 'tree',
          events: [{ assign: { id: entry.node.id, assignment: next } }],
          note: `Asked the worker on “${entry.node.title}” to record its result; ${entry.reason}.`
        }])
        try {
          await chat.send(assignment.paneId, nudgeBrief(entry.node, projectPath))
          continue
        } catch (error) {
          this.deps.warn?.(`[agent-runner] could not reach worker ${assignment.paneId}: ${String(error)}`)
        }
      }
      await store.mutate(projectPath, [{
        type: 'tree',
        events: [
          { update: { id: entry.node.id, state: 'blocked', summary: `Stopped: ${entry.reason}.` } },
          { assign: { id: entry.node.id, assignment: assignment ? { ...assignment, activityAt: now } : null } }
        ],
        note: `“${entry.node.title}” stopped because ${entry.reason}. The coordinator picks it up.`
      }])
    }
  }

  private async dispatch(
    projectPath: string, snapshot: ProjectSnapshot, plan: RunnerPlan, chat: RunnerChat, store: RunnerStore,
    coordinatorPaneId: string | null, run: ProjectRun, now: number
  ): Promise<void> {
    if (!plan.dispatch.length) return
    if (!coordinatorPaneId) {
      await this.reportNoCoordinator(projectPath, store, run)
      return
    }
    for (const node of plan.dispatch) {
      let paneId: string
      try {
        paneId = await chat.newWorker(coordinatorPaneId)
      } catch (error) {
        await store.mutate(projectPath, [{
          type: 'journal',
          text: `Could not open a worker for “${node.title}”: ${error instanceof Error ? error.message : String(error)}`
        }])
        return
      }
      this.paneProject.set(paneId, projectPath)
      const assignment: TaskAssignment = {
        paneId, startedAt: now, activityAt: now, activity: null,
        attempts: (node.assignment?.attempts ?? 0) + 1
      }
      await store.mutate(projectPath, [{
        type: 'tree',
        events: [
          { update: { id: node.id, state: 'active', summary: node.summary || 'Running in a worker.' } },
          { assign: { id: node.id, assignment } }
        ],
        note: `Started “${node.title}” in a worker.`
      }])
      try {
        await chat.send(paneId, workerBrief(projectPath, node, snapshot.direction))
      } catch (error) {
        await store.mutate(projectPath, [{
          type: 'tree',
          events: [{ update: { id: node.id, state: 'blocked', summary: 'Its worker could not be briefed.' } }],
          note: `“${node.title}” could not be handed to a worker: ${error instanceof Error ? error.message : String(error)}`
        }])
      }
    }
  }

  private async askCoordinator(
    projectPath: string, snapshot: ProjectSnapshot, plan: RunnerPlan, chat: RunnerChat, store: RunnerStore,
    coordinatorPaneId: string | null, run: ProjectRun
  ): Promise<void> {
    const signature = planSignature(snapshot)
    if (!coordinatorPaneId) {
      if (plan.coordinator) await this.reportNoCoordinator(projectPath, store, run)
      return
    }
    // A turn the user started counts: the coordinator has seen the store as it stands.
    const pane = chat.paneState(coordinatorPaneId)
    if (pane.running) return
    if (!plan.coordinator) {
      run.askedSignature = signature
      return
    }
    if (run.askedSignature === signature) return
    run.askedSignature = signature
    await chat.send(coordinatorPaneId, coordinatorBrief(plan.coordinator, snapshot))
  }

  private async reportNoCoordinator(projectPath: string, store: RunnerStore, run: ProjectRun): Promise<void> {
    if (run.warnedNoCoordinator) return
    run.warnedNoCoordinator = true
    await store.mutate(projectPath, [{
      type: 'journal',
      text: 'No coordinator chat is bound to this project, so nothing can be planned or dispatched. Open the project in the agent workspace and press Start building again.'
    }])
  }
}

/** What the coordinator would be planning against: every node's state, plus how much has happened. */
function planSignature(snapshot: ProjectSnapshot): string {
  const nodes = snapshot.tree.map((node: TreeNode) => `${node.id}:${node.state}`).join(',')
  return `${snapshot.phase}|${nodes}|${snapshot.journal.length}`
}
