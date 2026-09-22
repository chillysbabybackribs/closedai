// What the hive should do next, as a pure function of the project tree and the live workspace.
// Everything that talks to chats, stores, or timers lives in agent-runner.ts; this file decides.
// It exists so the loop's behaviour — concurrency, collisions, a worker that stopped without
// recording, an empty queue — can be tested without an app around it.

import type { HiveConfig } from '../../shared/project/coordinator.js'
import type { TreeNode } from '../../shared/project/tree.js'

/**
 * How long after a worker's last sign of life the loop waits before deciding its turn is over.
 * A pane that has just been handed its brief has not started a turn yet, so without this the
 * first check after dispatch would settle the task immediately.
 */
export const WORKER_GRACE_MS = 15_000

/** Dispatches of one task before the loop stops re-sending it and asks the coordinator instead. */
export const MAX_TASK_ATTEMPTS = 2

export type PaneState = {
  /** A chat record exists for this pane; it may be parked or detached. */
  exists: boolean
  running: boolean
  activity: string | null
}

export type RunnerInput = {
  nodes: readonly TreeNode[]
  hive: HiveConfig
  pane: (paneId: string) => PaneState
  now: number
}

export type Settlement = {
  node: TreeNode
  /** `nudge` re-sends the brief to the same worker; `block` hands the task back to the coordinator. */
  outcome: 'nudge' | 'block'
  reason: string
}

export type RunnerPlan = {
  /** Tasks whose worker is still on them. Nothing to do but keep their activity current. */
  carrying: TreeNode[]
  settle: Settlement[]
  /** Queued tasks to start now, in tree order. */
  dispatch: TreeNode[]
  /** Queued tasks left for a later pass, with why. */
  heldBack: Array<{ node: TreeNode; reason: string }>
  /** A planning turn to ask the coordinator for, or null when the hive has work in flight. */
  coordinator: 'plan' | 'replan' | null
  /** Why nothing is happening, when nothing is. */
  idle: string | null
}

export function planRun(input: RunnerInput): RunnerPlan {
  const tasks = input.nodes.filter((node) => node.kind === 'task')
  const paused = input.hive.dispatch.mode === 'paused'
  const carrying: TreeNode[] = []
  const settle: Settlement[] = []
  const heldBack: Array<{ node: TreeNode; reason: string }> = []

  for (const node of tasks) {
    if (node.state !== 'active') continue
    const assignment = node.assignment
    if (!assignment) {
      settle.push({ node, outcome: 'block', reason: 'it was marked active with no worker behind it' })
      continue
    }
    const pane = input.pane(assignment.paneId)
    if (pane.running || input.now - assignment.activityAt < WORKER_GRACE_MS) {
      carrying.push(node)
      continue
    }
    // Paused means "leave running work alone": a stalled task is settled when the user resumes.
    if (paused) {
      carrying.push(node)
      continue
    }
    if (!pane.exists) {
      settle.push({ node, outcome: 'block', reason: 'its worker chat is gone' })
    } else if (assignment.attempts < MAX_TASK_ATTEMPTS) {
      settle.push({ node, outcome: 'nudge', reason: 'its worker stopped without recording a result' })
    } else {
      settle.push({
        node,
        outcome: 'block',
        reason: `its worker stopped ${assignment.attempts} times without recording a result`
      })
    }
  }

  // A nudged task still occupies its worker, and both it and a carried task still hold their paths.
  const nudged = settle.filter((entry) => entry.outcome === 'nudge').map((entry) => entry.node)
  const claimed = new Set<string>()
  for (const node of [...carrying, ...nudged]) for (const path of normalizePaths(node)) claimed.add(path)
  let occupied = carrying.length + nudged.length
  const capacity = Math.max(1, Math.floor(input.hive.workers.maxConcurrent) || 1)

  const dispatch: TreeNode[] = []
  for (const node of tasks) {
    if (node.state !== 'queued') continue
    if (paused) {
      heldBack.push({ node, reason: 'dispatch is paused' })
      continue
    }
    if (occupied >= capacity) {
      heldBack.push({ node, reason: `${capacity} workers are already running` })
      continue
    }
    const collision = firstCollision(normalizePaths(node), claimed)
    if (collision) {
      heldBack.push({ node, reason: `another running task holds ${collision}` })
      continue
    }
    for (const path of normalizePaths(node)) claimed.add(path)
    occupied += 1
    dispatch.push(node)
  }

  const inFlight = carrying.length + nudged.length + dispatch.length
  let coordinator: RunnerPlan['coordinator'] = null
  let idle: string | null = null
  if (paused) {
    idle = 'Dispatch is paused; nothing new starts until you resume.'
  } else if (tasks.length === 0) {
    coordinator = 'plan'
  } else if (inFlight === 0 && heldBack.length === 0) {
    coordinator = 'replan'
  } else if (inFlight === 0) {
    idle = heldBack[0]!.reason
  }
  return { carrying, settle, dispatch, heldBack, coordinator, idle }
}

/**
 * Paths a task claims, as comparable strings. A task that declares none claims nothing: the
 * alternative — treating an undeclared task as touching everything — would serialise the whole
 * build the first time a coordinator forgot the field.
 */
function normalizePaths(node: TreeNode): string[] {
  if (!node.paths?.length) return []
  const cleaned = node.paths
    .map((path) => path.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((path) => path.length > 0 && path !== '.')
  return [...new Set(cleaned)]
}

/** The held path a task would walk into, or null. A folder claim covers everything beneath it. */
function firstCollision(paths: readonly string[], claimed: ReadonlySet<string>): string | null {
  for (const path of paths) {
    for (const held of claimed) {
      if (path === held || path.startsWith(`${held}/`) || held.startsWith(`${path}/`)) return held
    }
  }
  return null
}
