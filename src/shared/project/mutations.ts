// The one write path into a project store. The renderer, and later the coordinator's tool,
// describe what changed as a mutation; the store applies it with this pure function so the
// main process and an in-memory renderer fixture produce the same next state. Keep the verb
// set small: a verb earns its place when a real caller needs it, not when the blueprint names it.
import type { CoordinatorBinding, DispatchMode } from './coordinator.js'
import type { ClaritySlot, DirectionRecord } from './direction.js'
import type { ProjectJournalLine } from './journal.js'
import type { ProjectPhase } from './record.js'
import { createDefaultProjectStoreFile, type ProjectStoreFile } from './store-file.js'
import type { TaskAssignment, TreeNode, TreeState } from './tree.js'

/** A node as a caller describes it; the store stamps timestamps when it lands. */
export type PlannedNode = Omit<TreeNode, 'createdAt' | 'updatedAt'>

export type ProjectTreeEvent =
  | { add: PlannedNode }
  | { update: { id: string; state?: TreeState; summary?: string; detail?: string; paths?: string[] } }
  /** Which worker holds a task. The run loop writes this; a model is refused it by the tool parser. */
  | { assign: { id: string; assignment: TaskAssignment | null } }
  | { remove: { id: string } }
  /** Whole-tree replacement for prototype paths that rebuild the array; superseded by finer verbs as they arrive. */
  | { replace: TreeNode[] }

export type ProjectMutation =
  | { type: 'direction'; direction: DirectionRecord; asking: ClaritySlot | null }
  /** Direction confirmed: the build starts from one root node and an opening journal line. */
  | { type: 'start'; root: PlannedNode; note: string }
  | { type: 'tree'; events: ProjectTreeEvent[]; note?: string }
  /** `complete` stamps `acceptedAt`; leaving `complete` clears it and resets catch-up to now. */
  | { type: 'phase'; phase: ProjectPhase; note?: string }
  | { type: 'caughtUp'; note?: string }
  | { type: 'journal'; text: string }
  | { type: 'coordinator'; coordinator: CoordinatorBinding | null }
  /** Pause or resume the run loop for this project without leaving the building phase. */
  | { type: 'dispatch'; mode: DispatchMode; note?: string }
  /** Back to a blank intake (the restart control): everything but the hive config is discarded. */
  | { type: 'reset' }

export function applyTreeEvent(nodes: TreeNode[], event: ProjectTreeEvent, at: number): TreeNode[] {
  if ('add' in event) {
    return nodes.some((node) => node.id === event.add.id) ? nodes : [...nodes, { ...event.add, createdAt: at, updatedAt: at }]
  }
  if ('update' in event) {
    const { id, ...changes } = event.update
    return nodes.map((node) => node.id === id ? { ...node, ...defined(changes), updatedAt: at } : node)
  }
  if ('assign' in event) {
    const { id, assignment } = event.assign
    return nodes.map((node) => node.id === id ? { ...node, assignment, updatedAt: at } : node)
  }
  if ('remove' in event) return nodes.filter((node) => node.id !== event.remove.id)
  return event.replace
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function withNote(file: ProjectStoreFile, text: string | undefined, at: number): ProjectStoreFile {
  if (!text) return file
  const last = file.journal[file.journal.length - 1]
  const line: ProjectJournalLine = { id: (last?.id ?? 0) + 1, at, text }
  return { ...file, journal: [...file.journal, line] }
}

export function applyProjectMutation(file: ProjectStoreFile, mutation: ProjectMutation, now = Date.now()): ProjectStoreFile {
  switch (mutation.type) {
    case 'direction':
      return { ...file, direction: mutation.direction, discoveryAsking: mutation.asking, updatedAt: now }
    case 'start':
      return withNote({
        ...file, phase: 'building', discoveryAsking: null, startedAt: now, caughtUpAt: now, acceptedAt: null,
        tree: [{ ...mutation.root, createdAt: now, updatedAt: now }], journal: [], updatedAt: now
      }, mutation.note, now)
    case 'tree':
      return withNote({
        ...file, tree: mutation.events.reduce((nodes, event) => applyTreeEvent(nodes, event, now), file.tree), updatedAt: now
      }, mutation.note, now)
    case 'phase': {
      const leavingComplete = file.phase === 'complete' && mutation.phase !== 'complete'
      return withNote({
        ...file,
        phase: mutation.phase,
        acceptedAt: mutation.phase === 'complete' ? now : null,
        caughtUpAt: leavingComplete ? now : file.caughtUpAt,
        startedAt: mutation.phase === 'building' || mutation.phase === 'closing' ? file.startedAt ?? now : file.startedAt,
        updatedAt: now
      }, mutation.note, now)
    }
    case 'caughtUp':
      return withNote({ ...file, caughtUpAt: now, updatedAt: now }, mutation.note, now)
    case 'journal':
      return withNote({ ...file, updatedAt: now }, mutation.text, now)
    case 'coordinator':
      return { ...file, coordinator: mutation.coordinator, updatedAt: now }
    case 'dispatch':
      return withNote({
        ...file, hive: { ...file.hive, dispatch: { ...file.hive.dispatch, mode: mutation.mode } }, updatedAt: now
      }, mutation.note, now)
    case 'reset':
      return { ...createDefaultProjectStoreFile(now), hive: file.hive }
  }
}

export function applyProjectMutations(file: ProjectStoreFile, mutations: readonly ProjectMutation[], now = Date.now()): ProjectStoreFile {
  return mutations.reduce((current, mutation) => applyProjectMutation(current, mutation, now), file)
}
