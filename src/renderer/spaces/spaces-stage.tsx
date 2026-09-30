import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type Ref } from 'react'
import { Plus } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { chatTabIds } from '../chat-layout/layout-tabs.js'
import { readLayout } from '../chat-layout/layout-tree.js'
import { SpaceMiniature } from './space-miniature.js'
import { useSpaceStills } from './space-stills.js'
import {
  LABEL_HEIGHT, anchorChat, cameraTransform, createZoomGesture, liveTransform, newSpace, readSpaces, resolveCurrent,
  saveSpaces, slotAt, type SavedSpaces, type Size, type Space, type Workspace
} from './spaces-model.js'
import { GLIDE_MS, useSpaceNavigation } from './use-space-navigation.js'

export type SpacesHandle = {
  /** Zoom out to every space, or back into the one you came from (View → Overview, Ctrl+Shift+O). */
  toggleOverview: () => void
}

/** What the dock shows of the spaces and the moves it offers. */
export type SpacesDockNav = {
  /** The overview is showing; false inside a space and while zooming. */
  overview: boolean
  /** A zoom is under way, so moves are ignored until it lands. */
  moving: boolean
  spaceName: string
  canBack: boolean
  canForward: boolean
  toggleOverview: () => void
  step: (delta: -1 | 1) => void
}

const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'

const editable = (target: EventTarget | null): boolean => target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Main answers over IPC and then announces the result in a workspace event; wait for the event. */
async function until(done: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const end = performance.now() + timeoutMs
  while (!done()) {
    if (performance.now() > end) return false
    await new Promise((resolve) => window.setTimeout(resolve, 30))
  }
  return true
}

/**
 * Spaces around the workspace. Each project's layout is a space; zooming out shrinks the live
 * workspace into its slot beside drawings of the others, and choosing one zooms into it. Nothing
 * here transforms the workspace while you are in a space, so tiles, menus and the native browser
 * lay out exactly as they do without spaces.
 */
export function SpacesStage({ enabled, workspace, chats, selectedPaneId, children, dock, ref }: {
  /** Main window only: a detached window holds tabs of one project and has no browser. */
  enabled: boolean
  workspace: Workspace
  chats: readonly ChatRowSummary[]
  selectedPaneId: string
  /**
   * The live workspace for `spaceId` (absent in a detached window); `browserHeld` asks it to show
   * its browser as a still.
   */
  children: (shown: { browserHeld: boolean; spaceId?: string }) => ReactNode
  /** The dock, drawn over the stage in the main window. */
  dock?: (nav: SpacesDockNav) => ReactNode
  ref?: Ref<SpacesHandle>
}): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [saved, setSavedState] = useState(() => readSpaces(window.localStorage))
  const setSaved = useCallback((update: (value: SavedSpaces) => SavedSpaces) => setSavedState((value) => {
    const next = update(value)
    if (next !== value) saveSpaces(window.localStorage, next)
    return next
  }), [])
  const { spaces, current } = useMemo(() => resolveCurrent(saved.spaces, saved.current, workspace),
    [saved, workspace.cwd, workspace.projectPath])
  // The space shown is always one of yours and is remembered, so a relaunch returns to it.
  useEffect(() => {
    setSaved((value) => value.current === current.id && value.spaces.length === spaces.length ? value : { spaces, current: current.id })
  }, [spaces, current.id, setSaved])

  const latest = useRef({ workspace, chats, selectedPaneId, spaces })
  latest.current = { workspace, chats, selectedPaneId, spaces }
  const prepare = useCallback(async (space: Space): Promise<void> => {
    if (space.cwd !== latest.current.workspace.cwd) {
      await window.closedai.chat.selectSpace(space.projectPath)
      if (!await until(() => latest.current.workspace.cwd === space.cwd)) throw new Error(`${space.name} did not open`)
    }
    const available = new Set(latest.current.chats.map((row) => row.paneId))
    const anchor = anchorChat(readLayout(window.localStorage, space.id).tree, available)
    if (!anchor || anchor === latest.current.selectedPaneId) return
    await window.closedai.chat.openChat(anchor)
    await until(() => latest.current.selectedPaneId === anchor)
  }, [])
  // A new space is the folder you were working in, with a fresh chat: with no saved layout yet it
  // opens as that chat on the left and the browser on the right.
  const create = useCallback(async (): Promise<Space> => {
    const { workspace: from, spaces: list } = latest.current
    const space = newSpace(list, { cwd: from.cwd, projectPath: from.projectPath }, `space:${crypto.randomUUID()}`)
    const chatId = await window.closedai.chat.newPeer()
    await until(() => latest.current.selectedPaneId === chatId && latest.current.chats.some((row) => row.paneId === chatId))
    setSaved((value) => ({ ...value, spaces: [...value.spaces, space] }))
    return space
  }, [setSaved])
  const commit = useCallback((id: string) => setSaved((value) => ({ ...value, current: id })), [setSaved])

  const { still, capture } = useSpaceStills(stageRef)
  const nav = useSpaceNavigation({ enabled, current: current.id, spaces, size, stageRef, capture, prepare, create, commit })
  const { phase, camera, animate, slots, edges, step, toggle, enter, zoomOut } = nav
  useImperativeHandle(ref, () => ({ toggleOverview: toggle }), [toggle])

  useEffect(() => {
    const host = stageRef.current
    if (!host) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize((value) => value.width === box.width && value.height === box.height ? value : { width: box.width, height: box.height })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // Ctrl+scroll or a pinch zooms out of a space; in the overview any scroll zooms toward the pointer.
  const input = useRef({ phase, slots, spaces, current: current.id, step, zoomOut, enter })
  input.current = { phase, slots, spaces, current: current.id, step, zoomOut, enter }
  useEffect(() => {
    if (!enabled) return
    const host = stageRef.current!
    const gesture = createZoomGesture()
    const onWheel = (event: WheelEvent): void => {
      const state = input.current
      if (state.phase === 'space' && !event.ctrlKey) return
      event.preventDefault()
      const direction = gesture(event.deltaY, performance.now())
      if (state.phase === 'space' && direction === 'out') void state.zoomOut()
      else if (state.phase === 'overview' && direction === 'in') {
        const box = host.getBoundingClientRect()
        const index = slotAt(state.slots, { x: event.clientX - box.left, y: event.clientY - box.top })
        const target = state.spaces[index]
        if (target) void state.enter(target.id)
      }
    }
    // Alt+arrows and the mouse's side buttons walk the zoom history, as a browser walks pages.
    const onKey = (event: KeyboardEvent): void => {
      const state = input.current
      if (event.key === 'Escape' && state.phase === 'overview') {
        event.preventDefault()
        event.stopPropagation()
        void state.enter(state.current)
        return
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || editable(event.target)) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      void state.step(event.key === 'ArrowLeft' ? -1 : 1)
    }
    const onMouse = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      void input.current.step(event.button === 3 ? -1 : 1)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mouseup', onMouse)
    return () => {
      host.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [enabled])

  // Running chats per space, from each space's saved tabs; read only while the overview shows them.
  const zoomed = phase !== 'space' && phase !== 'arming'
  const running = useMemo(() => {
    const counts = new Map<string, number>()
    if (!zoomed) return counts
    const live = new Set(chats.filter((row) => row.running).map((row) => row.paneId))
    for (const space of spaces) {
      counts.set(space.id, chatTabIds(readLayout(window.localStorage, space.id).tree).filter((id) => live.has(id)).length)
    }
    return counts
  }, [chats, spaces, zoomed])

  // The stage re-renders for every streamed chunk (its live child is the workspace). The dock
  // element is built once per nav or dock change, so React reuses it and the dock's subtree does
  // not reconcile while a transcript streams.
  const stepNav = useCallback((delta: -1 | 1) => { void step(delta) }, [step])
  const dockNav = useMemo<SpacesDockNav>(() => ({
    overview: phase === 'overview',
    moving: phase !== 'space' && phase !== 'overview',
    spaceName: current.name,
    canBack: edges.back,
    canForward: edges.forward,
    toggleOverview: toggle,
    step: stepNav
  }), [phase, current.name, edges.back, edges.forward, toggle, stepNav])
  const dockNode = useMemo(() => dock?.(dockNav), [dock, dockNav])

  if (!enabled) return <div className="spaces-stage">{children({ browserHeld: false })}</div>
  const currentIndex = spaces.findIndex((space) => space.id === current.id)
  const currentSlot = slots[currentIndex]
  const addSlot = slots[spaces.length]
  const transition = animate ? `transform ${GLIDE_MS}ms ${EASE}` : 'none'
  const liveStyle: CSSProperties | undefined = zoomed && currentSlot
    ? { transform: liveTransform(camera, currentSlot, size), transition }
    : undefined
  return <><div ref={stageRef} className="spaces-stage" data-spaces-overview={phase === 'space' ? undefined : phase}>
    <div className="spaces-live" style={liveStyle} inert={phase !== 'space'}
      data-native-bounds-hold={zoomed ? '' : undefined}>
      {phase !== 'switching' && children({ browserHeld: phase !== 'space', spaceId: current.id })}
    </div>
    {zoomed && <div className="spaces-world" style={{ width: size.width, height: size.height, transform: cameraTransform(camera), transition }}
      onDoubleClick={(event) => { if (event.target === event.currentTarget) void enter(current.id) }}>
      {spaces.map((space, index) => {
        const slot = slots[index]
        if (!slot) return null
        const count = running.get(space.id) ?? 0
        const here = index === currentIndex
        const picture = here ? null : still(space.id)
        return <div key={space.id} className="spaces-slot-group" data-current={here}>
          <div className="spaces-slot-label" style={{ left: slot.x, top: slot.y - LABEL_HEIGHT, width: slot.width, height: LABEL_HEIGHT }}>
            <span className="spaces-slot-name">{space.name}</span>
            {count > 0 && <span className="spaces-slot-running">{count} running</span>}
          </div>
          <button type="button" className="spaces-slot" data-ui="spaces.slot" data-ui-key={space.id} data-current={here}
            style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}
            aria-label={`${here ? 'Return to' : 'Open'} workspace ${space.name}${count ? `, ${count} running` : ''}`}
            title={space.cwd} disabled={phase !== 'overview'} onClick={() => { void enter(space.id) }}>
            {picture && <img className="spaces-slot-still" src={picture} alt="" draggable={false} />}
            {!here && !picture && <div className="spaces-slot-scale" style={{ transform: `scale(${size.width ? slot.width / size.width : 1})` }}>
              <SpaceMiniature spaceId={space.id} size={size} chats={chats} />
            </div>}
          </button>
        </div>
      })}
      {addSlot && <button type="button" className="spaces-add" data-ui="spaces.add" disabled={phase !== 'overview'}
        style={{ left: addSlot.x, top: addSlot.y, width: addSlot.width, height: addSlot.height }}
        title={`New workspace in ${current.cwd}`} onClick={() => { void nav.add() }}>
        <Plus size={28} strokeWidth={1.6} aria-hidden="true" />
        <span>Add workspace</span>
      </button>}
    </div>}
    {nav.error && zoomed && <div className="spaces-error" role="alert">{nav.error}</div>}
  </div>{dockNode}</>
}
