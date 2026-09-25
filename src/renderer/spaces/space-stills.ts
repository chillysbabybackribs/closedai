import { useCallback, useRef, useState, type RefObject } from 'react'

const STILL_KEY = 'closedai.spaces.still:'
/** A capture slower than this is dropped: the zoom has started and would be in the picture. */
const CAPTURE_WAIT_MS = 250

export function readStill(storage: Pick<Storage, 'getItem'>, id: string): string | null {
  try {
    const value = storage.getItem(STILL_KEY + id)
    return value?.startsWith('data:image/') ? value : null
  } catch { return null }
}

/** Best effort: a full store keeps the still for this session only. */
export function saveStill(storage: Pick<Storage, 'setItem'>, id: string, url: string): void {
  try { storage.setItem(STILL_KEY + id, url) } catch { /* The overview draws the layout instead after a relaunch. */ }
}

/**
 * What each space looked like when you last zoomed out of it. The overview shows these for the
 * spaces you are not in; a space never left since this still store existed is drawn instead.
 */
export function useSpaceStills(stageRef: RefObject<HTMLElement | null>): {
  /** The still for space `id`: this session's capture, else the one saved before a relaunch. */
  still: (id: string) => string | null
  /** Capture the stage as the still of space `id`; resolves by the time the zoom may move it. */
  capture: (id: string) => Promise<void>
} {
  const [stills, setStills] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  const stored = useRef(new Map<string, string | null>())
  const still = useCallback((id: string): string | null => {
    if (stills.has(id)) return stills.get(id) ?? null
    if (!stored.current.has(id)) stored.current.set(id, readStill(window.localStorage, id))
    return stored.current.get(id) ?? null
  }, [stills])
  const capture = useCallback(async (id: string): Promise<void> => {
    const host = stageRef.current
    if (!host) return
    const box = host.getBoundingClientRect()
    let late = false
    const shot = window.closedai.windows.capture({ x: box.x, y: box.y, width: box.width, height: box.height })
      .then((url) => {
        if (!url || late) return
        saveStill(window.localStorage, id, url)
        setStills((value) => new Map(value).set(id, url))
      }, () => { /* The drawing stands in. */ })
    await Promise.race([shot, new Promise<void>((resolve) => window.setTimeout(() => { late = true; resolve() }, CAPTURE_WAIT_MS))])
  }, [stageRef])
  return { still, capture }
}
