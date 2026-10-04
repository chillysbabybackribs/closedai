import { chatPaneIds, type ChatLayout, type Rect } from '../chat-layout/layout-tree.js'
import { chatTabIds } from '../chat-layout/layout-tabs.js'

// A space is one workspace: its own saved split tree, tabs and browser position, and the project
// folder main selects while it is shown. Several spaces can share a folder. The overview lays every
// space out as a window-shaped slot; a camera zooms between a slot and the whole overview. Zooming
// is geometry only — which project main shows, and which chat it selects, change separately.

/** `id` also names the space's saved layout; spaces from before ids existed use their folder. */
export type Space = { id: string; cwd: string; projectPath: string | null; name: string }
export type SpaceStop = { kind: 'overview' } | { kind: 'space'; id: string }
export type SpaceHistory = { stops: SpaceStop[]; index: number }
/** Screen = translate(x, y) · scale(k) · world. */
export type Camera = { x: number; y: number; k: number }
export type Size = { width: number; height: number }
export type Workspace = { cwd: string; projectPath: string | null }
export type SavedSpaces = { spaces: Space[]; current: string | null }

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, k: 1 }
// v1 listed every recent project main remembered; v2 is only the spaces the user has.
const SPACES_KEY = 'closedai.spaces.v2'
const HISTORY_LIMIT = 50
export const OVERVIEW_PAD = 32
export const OVERVIEW_GAP = 28
export const LABEL_HEIGHT = 26
/** Even a lone space shrinks visibly, so zooming out always reads as leaving it. */
const MAX_SLOT_SCALE = 0.6

export function spaceName(cwd: string, projectPath: string | null): string {
  if (!projectPath) return 'Home'
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd
}

/**
 * The space being shown for main's workspace: the remembered one when it is in that folder, else
 * the first space in the folder, else a new space for it (the first launch, or a model's project
 * switch into a folder no space uses). Returns the list with that space in it.
 */
export function resolveCurrent(spaces: readonly Space[], currentId: string | null, workspace: Workspace): { spaces: Space[]; current: Space } {
  const remembered = spaces.find((space) => space.id === currentId && space.cwd === workspace.cwd)
  const inFolder = remembered ?? spaces.find((space) => space.cwd === workspace.cwd)
  if (inFolder) return { spaces: [...spaces], current: inFolder }
  const current = { id: workspace.cwd, cwd: workspace.cwd, projectPath: workspace.projectPath, name: spaceName(workspace.cwd, workspace.projectPath) }
  return { spaces: [...spaces.filter((space) => space.id !== current.id), current], current }
}

/** A new space in `workspace`'s folder, named after it and numbered when the name is taken. */
export function newSpace(spaces: readonly Space[], workspace: Workspace, id: string): Space {
  const base = spaceName(workspace.cwd, workspace.projectPath)
  const taken = new Set(spaces.map((space) => space.name))
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
  return { id, cwd: workspace.cwd, projectPath: workspace.projectPath, name }
}

/** Keep one workspace, choosing a neighbour when the current workspace closes. */
export function closeSpace(saved: SavedSpaces, id: string): SavedSpaces {
  const index = saved.spaces.findIndex((space) => space.id === id)
  if (index < 0 || saved.spaces.length <= 1) return saved
  const spaces = saved.spaces.filter((space) => space.id !== id)
  return { spaces, current: saved.current === id ? spaces[Math.min(index, spaces.length - 1)]!.id : saved.current }
}

/**
 * The chat to select before a space is shown: a chat in front of one of its tiles, else any of its
 * chat tabs. The shown layout adopts the selected chat, so selecting one of its own keeps another
 * space's chat from being pulled in.
 */
export function anchorChat(tree: ChatLayout | null, available: ReadonlySet<string>): string | null {
  return [...chatPaneIds(tree), ...chatTabIds(tree)].find((id) => available.has(id)) ?? null
}

export function readSpaces(storage: Pick<Storage, 'getItem'>): SavedSpaces {
  try {
    const raw = JSON.parse(storage.getItem(SPACES_KEY) ?? 'null') as { spaces?: unknown; current?: unknown } | null
    if (!Array.isArray(raw?.spaces)) return { spaces: [], current: null }
    const spaces: Space[] = []
    for (const entry of raw.spaces) {
      const { id, cwd, projectPath, name } = (entry ?? {}) as Record<string, unknown>
      if (typeof cwd !== 'string' || !cwd) continue
      const path = typeof projectPath === 'string' && projectPath ? projectPath : null
      const key = typeof id === 'string' && id ? id : cwd
      if (spaces.some((space) => space.id === key)) continue
      spaces.push({ id: key, cwd, projectPath: path, name: typeof name === 'string' && name ? name : spaceName(cwd, path) })
    }
    return { spaces, current: typeof raw.current === 'string' ? raw.current : null }
  } catch { return { spaces: [], current: null } }
}

export function saveSpaces(storage: Pick<Storage, 'setItem'>, saved: SavedSpaces): void {
  const spaces = saved.spaces.map(({ id, cwd, projectPath, name }) => ({ id, cwd, projectPath, name }))
  try { storage.setItem(SPACES_KEY, JSON.stringify({ spaces, current: saved.current })) } catch { /* Best-effort preference. */ }
}

/** The overview never puts more than this many spaces side by side. */
export const OVERVIEW_COLUMNS = 2

/**
 * Window-shaped slots for `count` spaces in a centred grid of at most two columns, each with room
 * for its label above; a short last row is centred. `withAdd` appends the Add workspace tile as one
 * more slot of the same size: beside the last space when the count is odd, else centred below.
 */
export function overviewSlots(count: number, size: Size, withAdd = false): Rect[] {
  const n = Math.max(1, count)
  const total = n + (withAdd ? 1 : 0)
  const { width: W, height: H } = size
  if (W <= 0 || H <= 0) return Array.from({ length: total }, () => ({ x: 0, y: 0, width: 0, height: 0 }))
  const cols = Math.min(OVERVIEW_COLUMNS, total)
  const rows = Math.ceil(total / cols)
  const byWidth = (W - 2 * OVERVIEW_PAD - (cols - 1) * OVERVIEW_GAP) / cols / W
  const byHeight = (H - 2 * OVERVIEW_PAD - rows * LABEL_HEIGHT - (rows - 1) * OVERVIEW_GAP) / rows / H
  const scale = Math.max(0.02, Math.min(MAX_SLOT_SCALE, byWidth, byHeight))
  const slotW = W * scale
  const slotH = H * scale
  const gridH = rows * (slotH + LABEL_HEIGHT) + (rows - 1) * OVERVIEW_GAP
  const top = (H - gridH) / 2
  return Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / cols)
    const inRow = Math.min(cols, total - row * cols)
    const rowW = inRow * slotW + (inRow - 1) * OVERVIEW_GAP
    return {
      x: (W - rowW) / 2 + (index - row * cols) * (slotW + OVERVIEW_GAP),
      y: top + row * (slotH + LABEL_HEIGHT + OVERVIEW_GAP) + LABEL_HEIGHT,
      width: slotW,
      height: slotH
    }
  })
}

export function focusCamera(slot: Rect, size: Size): Camera {
  const k = slot.width > 0 ? size.width / slot.width : 1
  return { x: -slot.x * k, y: -slot.y * k, k }
}

export function cameraTransform(camera: Camera): string {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`
}

/**
 * Where the live workspace sits: drawn at full stage size, scaled into `slot`, seen through the
 * camera. Both layers interpolate translate and scale linearly on the same curve, so the live
 * space and the drawn world stay registered through a glide.
 */
export function liveTransform(camera: Camera, slot: Rect, size: Size): string {
  const scale = size.width > 0 ? slot.width / size.width : 1
  return `translate(${camera.x + camera.k * slot.x}px, ${camera.y + camera.k * slot.y}px) scale(${camera.k * scale})`
}

export function slotAt(slots: readonly Rect[], point: { x: number; y: number }): number {
  return slots.findIndex((slot) => point.x >= slot.x && point.x <= slot.x + slot.width
    && point.y >= slot.y - LABEL_HEIGHT && point.y <= slot.y + slot.height)
}

export function sameStop(a: SpaceStop | undefined, b: SpaceStop | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  return a.kind === 'overview' || a.id === (b as { id: string }).id
}

/** Record a stop; stepping back and then going somewhere new drops the forward entries. */
export function visitStop(history: SpaceHistory, stop: SpaceStop): SpaceHistory {
  if (sameStop(history.stops[history.index], stop)) return history
  const stops = [...history.stops.slice(0, history.index + 1), stop].slice(-HISTORY_LIMIT)
  return { stops, index: stops.length - 1 }
}

export function stepStop(history: SpaceHistory, delta: -1 | 1): SpaceHistory | null {
  const index = history.index + delta
  return index >= 0 && index < history.stops.length ? { ...history, index } : null
}

/** Stops whose space no longer exists are skipped rather than failing the step. */
export function dropMissingStops(history: SpaceHistory, ids: ReadonlySet<string>): SpaceHistory {
  const keep = (stop: SpaceStop): boolean => stop.kind === 'overview' || ids.has(stop.id)
  if (history.stops.every(keep)) return history
  const before = history.stops.slice(0, history.index + 1).filter(keep).length
  const stops = history.stops.filter(keep)
  return { stops, index: Math.max(0, Math.min(stops.length - 1, before - 1)) }
}

/**
 * One wheel notch or a pinch of the same size is one zoom step. Trackpads send many small deltas,
 * so deltas accumulate to a threshold, and a step ignores input until its glide has had time to land.
 */
export function createZoomGesture(threshold = 40, cooldownMs = 380) {
  let total = 0
  let quietUntil = 0
  return (deltaY: number, now: number): 'in' | 'out' | null => {
    if (now < quietUntil) return null
    total += deltaY
    if (Math.abs(total) < threshold) return null
    const direction = total > 0 ? 'out' : 'in'
    total = 0
    quietUntil = now + cooldownMs
    return direction
  }
}
