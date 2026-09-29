import { useEffect, useState } from 'react'
import type { WorkspaceBackdrop } from '../../shared/backdrop-presets.js'
import { prepareBackdrop, releaseBackdrop } from './backdrop-image.js'
import { applyWorkspaceBackdrop, clearWorkspaceBackdrop } from './apply-workspace-backdrop.js'
import { resolveBackdropSource } from './resolve-backdrop-source.js'

export type BackdropStatus =
  | { state: 'off' }
  | { state: 'loading' }
  | { state: 'ready'; name: string }
  | { state: 'unavailable' }

/** Paints the chosen backdrop behind the shell: `data-backdrop` on the root plus the image and tone variables the glass styles read. */
export function useWorkspaceBackdrop(mode: WorkspaceBackdrop): BackdropStatus {
  const [status, setStatus] = useState<BackdropStatus>({ state: mode === 'off' ? 'off' : 'loading' })

  useEffect(() => {
    if (mode === 'off') {
      setStatus({ state: 'off' })
      return
    }
    let cancelled = false
    let prepared: Awaited<ReturnType<typeof prepareBackdrop>> | null = null
    setStatus({ state: 'loading' })
    void (async () => {
      const wallpaper = await resolveBackdropSource(mode)
      const backdrop = wallpaper
        ? await prepareBackdrop(wallpaper, window.screen.width * window.devicePixelRatio).catch(() => null)
        : null
      if (cancelled) {
        if (backdrop) releaseBackdrop(backdrop)
        return
      }
      if (!backdrop) {
        setStatus({ state: 'unavailable' })
        return
      }
      prepared = backdrop
      applyWorkspaceBackdrop(document.documentElement, mode, backdrop)
      setStatus({ state: 'ready', name: backdrop.name })
    })()
    return () => {
      cancelled = true
      clearWorkspaceBackdrop(document.documentElement)
      if (prepared) releaseBackdrop(prepared)
    }
  }, [mode])

  return status
}
