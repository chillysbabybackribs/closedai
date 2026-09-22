import type { EvidenceItem } from './direction.js'

export type TreeKind = 'root' | 'scope' | 'task' | 'research' | 'amendment' | 'proposal'
export type TreeState = 'anchored' | 'active' | 'queued' | 'complete' | 'provisional' | 'confirmed' | 'blocked'

/**
 * Which worker chat is carrying a task. Written by the run loop in main, never by a model: a
 * model can say a task is finished, but only the process that opened the worker knows which pane
 * is running it and whether that pane is still alive.
 */
export type TaskAssignment = {
  /** Chat pane running the task. The node's detail reads this pane's transcript. */
  paneId: string
  startedAt: number
  /** When the pane last reported something new; a fresh stamp is what keeps a node from settling early. */
  activityAt: number
  /** What the pane last said it was doing, so a node shows progress without opening the worker. */
  activity: string | null
  /** Dispatches of this task so far, including the current one. */
  attempts: number
}

export type TreeNode = {
  id: string
  parent?: string
  kind: TreeKind
  state: TreeState
  title: string
  summary: string
  detail: string
  links?: EvidenceItem[]
  /**
   * Repo-relative files or folders a task expects to touch. Two tasks whose paths overlap never
   * run at the same time; a task that declares none claims nothing and runs beside anything.
   */
  paths?: string[]
  /** The live worker, or the last one, once the run loop has dispatched this task. */
  assignment?: TaskAssignment | null
  /** Epoch ms. Every node records when it appeared and when it last changed. */
  createdAt: number
  updatedAt: number
}
