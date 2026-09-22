// Untrusted JSON from a model becomes typed ProjectMutation values here, or a list of problems
// the model can act on. The reducer in src/shared/project/mutations.ts trusts its input, so
// this is the only place a tool-supplied mutation is checked. Two verbs are refused outright:
// `reset` belongs to the restart control and `coordinator` to the pane that binds the chat.

import type { ClaritySlot, DirectionRecord, EvidenceItem } from '../../../shared/project/direction.js'
import type { PlannedNode, ProjectMutation, ProjectTreeEvent } from '../../../shared/project/mutations.js'
import type { ProjectPhase } from '../../../shared/project/record.js'
import type { TreeKind, TreeNode, TreeState } from '../../../shared/project/tree.js'

export type ParsedMutations = { mutations: ProjectMutation[]; problems: string[] }

export const MAX_MUTATIONS = 32
export const MAX_TREE_EVENTS = 64

const KINDS: readonly TreeKind[] = ['root', 'scope', 'task', 'research', 'amendment', 'proposal']
const STATES: readonly TreeState[] = ['anchored', 'active', 'queued', 'complete', 'provisional', 'confirmed', 'blocked']
const PHASES: readonly ProjectPhase[] = ['intake', 'confirm', 'building', 'closing', 'complete']
const SLOTS: readonly ClaritySlot[] = ['idea', 'user', 'journey', 'boundaries']
const LIMITS = { id: 80, title: 120, summary: 200, detail: 4000, note: 1000, text: 1000, path: 400 } as const
/** Paths one task may claim. Past this the claim stops being a scope and starts being the repo. */
const MAX_PATHS = 24

type Record_ = Record<string, unknown>
const isRecord = (value: unknown): value is Record_ => typeof value === 'object' && value !== null && !Array.isArray(value)

class Problems {
  readonly list: string[] = []
  add(path: string, message: string): void { this.list.push(`${path} ${message}`) }
}

export function parseProjectMutations(raw: unknown): ParsedMutations {
  const problems = new Problems()
  if (!Array.isArray(raw)) return { mutations: [], problems: ['mutations must be an array'] }
  if (raw.length === 0) return { mutations: [], problems: ['mutations must not be empty'] }
  if (raw.length > MAX_MUTATIONS) return { mutations: [], problems: [`mutations must have at most ${MAX_MUTATIONS} entries`] }
  const mutations: ProjectMutation[] = []
  raw.forEach((entry, index) => {
    const parsed = parseMutation(entry, `mutations[${index}]`, problems)
    if (parsed) mutations.push(parsed)
  })
  return { mutations: problems.list.length ? [] : mutations, problems: problems.list }
}

function parseMutation(raw: unknown, path: string, problems: Problems): ProjectMutation | null {
  if (!isRecord(raw)) { problems.add(path, 'must be an object'); return null }
  switch (raw.type) {
    case 'journal': {
      const text = str(raw, 'text', path, problems, LIMITS.text, true)
      return text ? { type: 'journal', text } : null
    }
    case 'caughtUp':
      return { type: 'caughtUp', note: str(raw, 'note', path, problems, LIMITS.note) }
    case 'phase': {
      const phase = raw.phase
      if (!PHASES.includes(phase as ProjectPhase)) { problems.add(`${path}.phase`, `must be one of ${PHASES.join(', ')}`); return null }
      return { type: 'phase', phase: phase as ProjectPhase, note: str(raw, 'note', path, problems, LIMITS.note) }
    }
    case 'tree': {
      if (!Array.isArray(raw.events) || raw.events.length === 0) { problems.add(`${path}.events`, 'must be a non-empty array'); return null }
      if (raw.events.length > MAX_TREE_EVENTS) { problems.add(`${path}.events`, `must have at most ${MAX_TREE_EVENTS} entries`); return null }
      const events = raw.events.map((event, index) => parseTreeEvent(event, `${path}.events[${index}]`, problems))
      if (events.some((event) => !event)) return null
      return { type: 'tree', events: events as ProjectTreeEvent[], note: str(raw, 'note', path, problems, LIMITS.note) }
    }
    case 'start': {
      const root = parseNode(raw.root, `${path}.root`, problems)
      const note = str(raw, 'note', path, problems, LIMITS.note, true)
      if (!root || !note) return null
      if (root.kind !== 'root') { problems.add(`${path}.root.kind`, 'must be "root"'); return null }
      return { type: 'start', root, note }
    }
    case 'direction': {
      const direction = parseDirection(raw.direction, `${path}.direction`, problems)
      const asking = raw.asking
      if (asking !== null && !SLOTS.includes(asking as ClaritySlot)) { problems.add(`${path}.asking`, `must be null or one of ${SLOTS.join(', ')}`); return null }
      return direction ? { type: 'direction', direction, asking: asking as ClaritySlot | null } : null
    }
    case 'reset':
      problems.add(`${path}.type`, '"reset" is the restart control\'s verb; a model never blanks a project'); return null
    case 'coordinator':
      problems.add(`${path}.type`, '"coordinator" is written by the workspace pane, not through this tool'); return null
    case 'dispatch':
      problems.add(`${path}.type`, '"dispatch" is the pause control\'s verb; the run loop and the user own it'); return null
    default:
      problems.add(`${path}.type`, 'must be one of tree, journal, phase, caughtUp, start, direction'); return null
  }
}

function parseTreeEvent(raw: unknown, path: string, problems: Problems): ProjectTreeEvent | null {
  if (!isRecord(raw)) { problems.add(path, 'must be an object'); return null }
  if ('add' in raw) {
    const node = parseNode(raw.add, `${path}.add`, problems)
    return node ? { add: node } : null
  }
  if ('update' in raw) {
    if (!isRecord(raw.update)) { problems.add(`${path}.update`, 'must be an object'); return null }
    const id = str(raw.update, 'id', `${path}.update`, problems, LIMITS.id, true)
    const state = raw.update.state
    if (state !== undefined && !STATES.includes(state as TreeState)) { problems.add(`${path}.update.state`, `must be one of ${STATES.join(', ')}`); return null }
    const summary = str(raw.update, 'summary', `${path}.update`, problems, LIMITS.summary)
    const detail = str(raw.update, 'detail', `${path}.update`, problems, LIMITS.detail)
    const paths = raw.update.paths === undefined ? undefined : parsePaths(raw.update.paths, `${path}.update.paths`, problems)
    if (!id) return null
    if (state === undefined && summary === undefined && detail === undefined && paths === undefined) {
      problems.add(`${path}.update`, 'must change state, summary, detail, or paths'); return null
    }
    return { update: { id, state: state as TreeState | undefined, summary, detail, ...(paths ? { paths } : {}) } }
  }
  if ('remove' in raw) {
    if (!isRecord(raw.remove)) { problems.add(`${path}.remove`, 'must be an object with id'); return null }
    const id = str(raw.remove, 'id', `${path}.remove`, problems, LIMITS.id, true)
    return id ? { remove: { id } } : null
  }
  if ('assign' in raw) {
    // Which worker holds a task is the run loop's to know; a model saying it would make the
    // workspace show a pane that nothing is running.
    problems.add(`${path}.assign`, 'is written by the run loop, not through this tool'); return null
  }
  if ('replace' in raw) {
    // Whole-tree replacement drops every node another chat wrote in between; models add and update.
    problems.add(`${path}.replace`, 'is not accepted from a model; use add, update, and remove events'); return null
  }
  problems.add(path, 'must be one of { add }, { update }, { remove }')
  return null
}

function parseNode(raw: unknown, path: string, problems: Problems): PlannedNode | null {
  if (!isRecord(raw)) { problems.add(path, 'must be an object'); return null }
  const id = str(raw, 'id', path, problems, LIMITS.id, true)
  const title = str(raw, 'title', path, problems, LIMITS.title, true)
  const summary = str(raw, 'summary', path, problems, LIMITS.summary) ?? ''
  const detail = str(raw, 'detail', path, problems, LIMITS.detail) ?? ''
  const parent = str(raw, 'parent', path, problems, LIMITS.id)
  const kind = raw.kind ?? 'task'
  const state = raw.state ?? 'queued'
  if (!KINDS.includes(kind as TreeKind)) problems.add(`${path}.kind`, `must be one of ${KINDS.join(', ')}`)
  if (!STATES.includes(state as TreeState)) problems.add(`${path}.state`, `must be one of ${STATES.join(', ')}`)
  const links = raw.links === undefined ? undefined : parseEvidence(raw.links, `${path}.links`, problems)
  const paths = raw.paths === undefined ? undefined : parsePaths(raw.paths, `${path}.paths`, problems)
  if (kind !== 'root' && !parent) problems.add(`${path}.parent`, 'is required for every node but the root')
  if (!id || !title || problems.list.length) return null
  const node: PlannedNode = { id, kind: kind as TreeKind, state: state as TreeState, title, summary, detail }
  if (parent) node.parent = parent
  if (links) node.links = links
  if (paths?.length) node.paths = paths
  return node
}

/** Repo-relative paths a task claims, so the run loop can keep two workers out of one file. */
function parsePaths(raw: unknown, path: string, problems: Problems): string[] | null {
  if (!Array.isArray(raw)) { problems.add(path, 'must be an array of repo-relative paths'); return null }
  if (raw.length > MAX_PATHS) { problems.add(path, `must have at most ${MAX_PATHS} entries`); return null }
  const paths: string[] = []
  raw.forEach((entry, index) => {
    const at = `${path}[${index}]`
    if (typeof entry !== 'string') { problems.add(at, 'must be a string'); return }
    const trimmed = entry.trim()
    if (!trimmed) { problems.add(at, 'must not be empty'); return }
    if (trimmed.length > LIMITS.path) { problems.add(at, `must be at most ${LIMITS.path} characters`); return }
    paths.push(trimmed)
  })
  return problems.list.length ? null : paths
}

function parseDirection(raw: unknown, path: string, problems: Problems): DirectionRecord | null {
  if (!isRecord(raw)) { problems.add(path, 'must be an object'); return null }
  const idea = str(raw, 'idea', path, problems, LIMITS.detail, true)
  const nullable = (key: 'user' | 'journey' | 'boundaries'): string | null | undefined => {
    if (raw[key] === null || raw[key] === undefined) return null
    return str(raw, key, path, problems, LIMITS.detail)
  }
  const user = nullable('user'), journey = nullable('journey'), boundaries = nullable('boundaries')
  const strings = (key: 'unknowns' | 'refinements'): string[] | null => {
    const value = raw[key] ?? []
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) { problems.add(`${path}.${key}`, 'must be an array of strings'); return null }
    return value as string[]
  }
  const unknowns = strings('unknowns'), refinements = strings('refinements')
  const evidence = raw.evidence === undefined ? [] : parseEvidence(raw.evidence, `${path}.evidence`, problems)
  if (!idea || !unknowns || !refinements || !evidence || problems.list.length) return null
  return { idea, user: user ?? null, journey: journey ?? null, boundaries: boundaries ?? null, evidence, unknowns, refinements }
}

function parseEvidence(raw: unknown, path: string, problems: Problems): EvidenceItem[] | null {
  if (!Array.isArray(raw)) { problems.add(path, 'must be an array'); return null }
  const items: EvidenceItem[] = []
  raw.forEach((entry, index) => {
    const at = `${path}[${index}]`
    if (!isRecord(entry)) { problems.add(at, 'must be an object'); return }
    const label = str(entry, 'label', at, problems, LIMITS.title, true)
    const url = str(entry, 'url', at, problems, 2000, true)
    const informs = str(entry, 'informs', at, problems, LIMITS.summary) ?? ''
    const id = str(entry, 'id', at, problems, LIMITS.id) ?? `ev-${index + 1}`
    if (label && url) items.push({ id, label, url, informs })
  })
  return problems.list.length ? null : items
}

function str(record: Record_, key: string, path: string, problems: Problems, max: number, required = false): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) {
    if (required) problems.add(`${path}.${key}`, 'is required')
    return undefined
  }
  if (typeof value !== 'string') { problems.add(`${path}.${key}`, 'must be a string'); return undefined }
  const trimmed = value.trim()
  if (required && !trimmed) { problems.add(`${path}.${key}`, 'must not be empty'); return undefined }
  if (trimmed.length > max) { problems.add(`${path}.${key}`, `must be at most ${max} characters`); return undefined }
  return trimmed
}

/** Bounded node view for tool results: enough to plan against, never the whole detail. */
export function nodeSummary(node: TreeNode, detailChars: number): Record<string, unknown> {
  const detail = node.detail.length > detailChars ? `${node.detail.slice(0, detailChars)}…` : node.detail
  return {
    id: node.id, ...(node.parent ? { parent: node.parent } : {}), kind: node.kind, state: node.state,
    title: node.title, summary: node.summary, ...(detail ? { detail } : {}),
    ...(node.paths?.length ? { paths: node.paths } : {}),
    // Enough for a coordinator to see a task is really running without reading the worker.
    ...(node.assignment ? { worker: { running: node.state === 'active', attempts: node.assignment.attempts, activity: node.assignment.activity } } : {}),
    ...(node.links?.length ? { links: node.links } : {}), updatedAt: node.updatedAt
  }
}
