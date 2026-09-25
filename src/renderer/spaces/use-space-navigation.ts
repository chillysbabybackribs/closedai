import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { errorMessage } from '../error-message.js'
import {
  IDENTITY_CAMERA, dropMissingStops, focusCamera, overviewSlots, stepStop, visitStop,
  type Camera, type Size, type Space, type SpaceHistory
} from './spaces-model.js'

/**
 * `space`: the workspace as it always was, no transform anywhere. `arming`: the browser is being
 * swapped for its still before anything scales. `gliding`: the camera is moving. `overview`: every
 * space is visible. `switching`: a space's drawing fills the stage while main changes project.
 */
export type SpacePhase = 'space' | 'arming' | 'gliding' | 'overview' | 'switching'

export const GLIDE_MS = 420
/** Past this the zoom starts anyway; the native page then drops out a frame late instead of never. */
const STILL_WAIT_MS = 400

const frames = (count: number): Promise<void> => new Promise((resolve) => {
  const next = (left: number): void => { if (left <= 0) resolve(); else requestAnimationFrame(() => next(left - 1)) }
  next(count)
})
const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * The native page paints above the renderer and cannot scale. Occluding it shows a captured still in
 * the browser box; zooming starts only once that still is on screen, so the page never floats
 * full-size over a shrinking workspace.
 */
async function browserStillReady(root: HTMLElement | null): Promise<void> {
  const browser = root?.querySelector('.workspace-right[data-with-browser="yes"]')
  if (!browser) return
  const started = performance.now()
  while (performance.now() - started < STILL_WAIT_MS) {
    if (browser.querySelector('.browser-view-freeze')) { await frames(2); return }
    await frames(1)
  }
}

export function useSpaceNavigation({ enabled, current, spaces, size, stageRef }: {
  enabled: boolean
  current: string
  spaces: readonly Space[]
  size: Size
  stageRef: RefObject<HTMLDivElement | null>
}) {
  const [phase, setPhaseState] = useState<SpacePhase>('space')
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA)
  const [animate, setAnimate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const phaseRef = useRef<SpacePhase>('space')
  const setPhase = useCallback((next: SpacePhase) => { phaseRef.current = next; setPhaseState(next) }, [])
  const history = useRef<SpaceHistory>({ stops: [{ kind: 'space', id: current }], index: 0 })
  // Every sequence takes a ticket; a newer gesture makes an older sequence's remaining steps no-ops.
  const ticket = useRef(0)
  // Focus inside the space (usually a composer) returns when you come back to it.
  const returnFocus = useRef<HTMLElement | null>(null)
  // One slot per space, then one for "Add workspace".
  const slots = useMemo(() => overviewSlots(spaces.length + 1, size), [spaces.length, size])
  const live = useRef({ current, spaces, slots, size })
  live.current = { current, spaces, slots, size }
  const slotOf = useCallback((id: string) => {
    const { spaces: list, slots: rects } = live.current
    return rects[list.findIndex((space) => space.id === id)] ?? null
  }, [])
  const glide = useCallback(async (next: Camera, token: number): Promise<boolean> => {
    setAnimate(true)
    setCamera(next)
    await wait(reducedMotion() ? 0 : GLIDE_MS)
    return token === ticket.current
  }, [])

  const land = useCallback(() => {
    setAnimate(false)
    setCamera(IDENTITY_CAMERA)
    setPhase('space')
    const target = returnFocus.current
    returnFocus.current = null
    if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }))
  }, [setPhase])

  const zoomOut = useCallback(async (record = true): Promise<void> => {
    const { current: id, size: stage } = live.current
    const slot = slotOf(id)
    if (!enabled || phaseRef.current !== 'space' || !slot || stage.width <= 0) return
    const token = ++ticket.current
    const active = document.activeElement
    returnFocus.current = active instanceof HTMLElement && stageRef.current?.contains(active) ? active : null
    setError(null)
    setPhase('arming')
    await browserStillReady(stageRef.current)
    if (token !== ticket.current) return
    // Start from the camera that shows the current space full-size, then let it pull back.
    setAnimate(false)
    setCamera(focusCamera(slot, stage))
    setPhase('gliding')
    await frames(2)
    if (token !== ticket.current || !await glide(IDENTITY_CAMERA, token)) return
    setPhase('overview')
    if (record) history.current = visitStop(history.current, { kind: 'overview' })
  }, [enabled, glide, setPhase, slotOf, stageRef])

  const enter = useCallback(async (id: string, record = true): Promise<void> => {
    const slot = slotOf(id)
    const space = live.current.spaces.find((entry) => entry.id === id)
    if (phaseRef.current !== 'overview' || !slot || !space) return
    const token = ++ticket.current
    setError(null)
    setPhase('gliding')
    if (!await glide(focusCamera(slot, live.current.size), token)) return
    if (record) history.current = visitStop(history.current, { kind: 'space', id })
    if (id === live.current.current) { land(); return }
    // The drawing now fills the stage; the live space arrives when main announces the new project.
    setPhase('switching')
    try {
      await window.closedai.chat.selectSpace(space.projectPath)
    } catch (reason) {
      if (token !== ticket.current) return
      setError(errorMessage(reason, 'Could not open that space'))
      history.current = visitStop(history.current, { kind: 'overview' })
      setPhase('gliding')
      if (await glide(IDENTITY_CAMERA, token)) setPhase('overview')
    }
  }, [glide, land, setPhase, slotOf])

  // Main changed project: the one being entered, a folder opened from the overview, or a model's
  // project switch. The new space becomes the stop; a switch lands, anything else glides in.
  const previous = useRef(current)
  useLayoutEffect(() => {
    if (previous.current === current) return
    previous.current = current
    history.current = dropMissingStops(visitStop(history.current, { kind: 'space', id: current }), new Set(spaces.map((space) => space.id)))
    if (phaseRef.current === 'switching') { land(); return }
    if (phaseRef.current !== 'overview' && phaseRef.current !== 'gliding') return
    const slot = slotOf(current)
    const token = ++ticket.current
    setPhase('gliding')
    void (slot ? glide(focusCamera(slot, live.current.size), token) : Promise.resolve(true)).then((ok) => { if (ok) land() })
  }, [current, spaces, glide, land, setPhase, slotOf])

  const toggle = useCallback((): void => {
    if (phaseRef.current === 'space') void zoomOut()
    else if (phaseRef.current === 'overview') void enter(live.current.current)
  }, [zoomOut, enter])

  /** Back/forward through zoom stops; a step to another space passes through the overview. */
  const step = useCallback(async (delta: -1 | 1): Promise<void> => {
    if (phaseRef.current !== 'space' && phaseRef.current !== 'overview') return
    const next = stepStop(history.current, delta)
    if (!next) return
    const stop = next.stops[next.index]!
    history.current = next
    if (stop.kind === 'overview') { await zoomOut(false); return }
    if (phaseRef.current === 'space') {
      if (stop.id === live.current.current) return
      await zoomOut(false)
    }
    await enter(stop.id, false)
  }, [zoomOut, enter])

  const openFolder = useCallback(async (): Promise<void> => {
    setError(null)
    try { await window.closedai.chat.openSpace() } catch (reason) { setError(errorMessage(reason, 'Could not open that folder')) }
  }, [])

  return { phase, camera, animate, slots, error, zoomOut, enter, toggle, step, openFolder }
}
