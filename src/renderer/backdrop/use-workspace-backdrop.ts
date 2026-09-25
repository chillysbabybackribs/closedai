import { useEffect, useState } from 'react'
import type { WorkspaceBackdrop } from '../settings/appearance-settings.js'
import { prepareBackdrop, releaseBackdrop } from './backdrop-image.js'
import { backdropTone } from './backdrop-tone.js'

export type BackdropStatus =
  | { state: 'off' }
  | { state: 'loading' }
  | { state: 'ready'; name: string }
  | { state: 'unavailable' }

const ROOT_PROPERTIES = ['--backdrop-image', '--backdrop-blur', '--backdrop-dim', '--backdrop-glass'] as const

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
      const wallpaper = await window.closedai.window.desktopWallpaper().catch(() => null)
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
      const tone = backdropTone(backdrop.luminance)
      const root = document.documentElement
      root.style.setProperty('--backdrop-image', `url("${backdrop.image}")`)
      root.style.setProperty('--backdrop-blur', `url("${backdrop.blurred}")`)
      root.style.setProperty('--backdrop-dim', String(tone.dim))
      root.style.setProperty('--backdrop-glass', String(tone.glass))
      root.dataset.backdrop = mode
      setStatus({ state: 'ready', name: backdrop.name })
    })()
    return () => {
      cancelled = true
      const root = document.documentElement
      delete root.dataset.backdrop
      for (const property of ROOT_PROPERTIES) root.style.removeProperty(property)
      if (prepared) releaseBackdrop(prepared)
    }
  }, [mode])

  return status
}
