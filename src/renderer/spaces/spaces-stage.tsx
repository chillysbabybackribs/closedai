import { useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type Ref } from 'react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { SpaceMiniature } from './space-miniature.js'
import {
  LABEL_HEIGHT, cameraTransform, createZoomGesture, liveTransform, orderedSpaces, readSpaceOrder, saveSpaceOrder, slotAt,
  type Size
} from './spaces-model.js'
import { GLIDE_MS, useSpaceNavigation } from './use-space-navigation.js'

export type SpacesHandle = {
  /** Zoom out to every space, or back into the one you came from (View → Overview, Ctrl+Shift+O). */
  toggleOverview: () => void
}

const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'

const editable = (target: EventTarget | null): boolean => target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/**
 * Spaces around the workspace. Each project's layout is a space; zooming out shrinks the live
 * workspace into its slot beside drawings of the others, and choosing one zooms into it. Nothing
 * here transforms the workspace while you are in a space, so tiles, menus and the native browser
 * lay out exactly as they do without spaces.
 */
export function SpacesStage({ enabled, workspace, chats, children, ref }: {
  /** Main window only: a detached window holds tabs of one project and has no browser. */
  enabled: boolean
  workspace: { cwd: string; projectPath: string | null; recentProjects?: Array<{ cwd: string; projectPath: string }> }
  chats: readonly ChatRowSummary[]
  /** The live workspace; `browserHeld` asks it to show its browser as a still. */
  children: (browserHeld: boolean) => ReactNode
  ref?: Ref<SpacesHandle>
}): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [order, setOrder] = useState(() => readSpaceOrder(window.localStorage))
  const spaces = useMemo(() => orderedSpaces(workspace, workspace.recentProjects ?? [], order),
    [workspace.cwd, workspace.projectPath, workspace.recentProjects, order])
  const nav = useSpaceNavigation({ enabled, current: workspace.cwd, spaces, size, stageRef })
  const { phase, camera, animate, slots, step, toggle, enter, zoomOut } = nav
  useImperativeHandle(ref, () => ({ toggleOverview: toggle }), [toggle])

  useEffect(() => {
    const ids = spaces.map((space) => space.id)
    if (ids.join('\0') === order.join('\0')) return
    saveSpaceOrder(window.localStorage, ids)
    setOrder(ids)
  }, [spaces, order])

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
  const input = useRef({ phase, slots, spaces, current: workspace.cwd, step, zoomOut, enter })
  input.current = { phase, slots, spaces, current: workspace.cwd, step, zoomOut, enter }
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

  const running = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of chats) if (row.running) counts.set(row.cwd, (counts.get(row.cwd) ?? 0) + 1)
    return counts
  }, [chats])

  if (!enabled) return <div className="spaces-stage">{children(false)}</div>
  const zoomed = phase !== 'space' && phase !== 'arming'
  const currentIndex = spaces.findIndex((space) => space.id === workspace.cwd)
  const currentSlot = slots[currentIndex]
  const transition = animate ? `transform ${GLIDE_MS}ms ${EASE}` : 'none'
  const liveStyle: CSSProperties | undefined = zoomed && currentSlot
    ? { transform: liveTransform(camera, currentSlot, size), transition }
    : undefined
  return <div ref={stageRef} className="spaces-stage" data-spaces-overview={phase === 'space' ? undefined : phase}>
    <div className="spaces-live" style={liveStyle} inert={phase !== 'space'}
      data-native-bounds-hold={zoomed ? '' : undefined}>
      {children(phase !== 'space')}
    </div>
    {zoomed && <div className="spaces-world" style={{ width: size.width, height: size.height, transform: cameraTransform(camera), transition }}
      onDoubleClick={(event) => { if (event.target === event.currentTarget) void enter(workspace.cwd) }}>
      {spaces.map((space, index) => {
        const slot = slots[index]
        if (!slot) return null
        const count = running.get(space.cwd) ?? 0
        const here = index === currentIndex
        return <div key={space.id} className="spaces-slot-group" data-current={here}>
          <div className="spaces-slot-label" style={{ left: slot.x, top: slot.y - LABEL_HEIGHT, width: slot.width, height: LABEL_HEIGHT }}>
            <span className="spaces-slot-name">{space.name}</span>
            {count > 0 && <span className="spaces-slot-running">{count} running</span>}
          </div>
          <button type="button" className="spaces-slot" data-ui="spaces.slot" data-ui-key={space.id} data-current={here}
            style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}
            aria-label={`${here ? 'Return to' : 'Open'} space ${space.name}${count ? `, ${count} running` : ''}`}
            title={space.cwd} disabled={phase !== 'overview'} onClick={() => { void enter(space.id) }}>
            {!here && <div className="spaces-slot-scale" style={{ transform: `scale(${size.width ? slot.width / size.width : 1})` }}>
              <SpaceMiniature cwd={space.cwd} size={size} chats={chats} />
            </div>}
          </button>
        </div>
      })}
    </div>}
    {phase === 'overview' && <div className="spaces-actions">
      <button type="button" className="spaces-action" data-ui="spaces.open-folder" onClick={() => { void nav.openFolder() }}>
        Open folder as space…
      </button>
    </div>}
    {nav.error && zoomed && <div className="spaces-error" role="alert">{nav.error}</div>}
  </div>
}
