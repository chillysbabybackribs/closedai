import type { DesktopWallpaper } from '../../shared/desktop-wallpaper.js'
import {
  backdropPresetId,
  BACKDROP_PRESET_LABELS,
  type WorkspaceBackdrop
} from '../../shared/backdrop-presets.js'
import { presetAssetUrl } from './backdrop-preset-assets.js'

/** Load wallpaper bytes for any non-off backdrop mode. */
export async function resolveBackdropSource(mode: WorkspaceBackdrop): Promise<DesktopWallpaper | null> {
  if (mode === 'off') return null
  if (mode === 'desktop') return window.closedai.window.desktopWallpaper().catch(() => null)
  const preset = backdropPresetId(mode)
  if (!preset) return null
  try {
    const response = await fetch(presetAssetUrl(preset))
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      name: BACKDROP_PRESET_LABELS[preset],
      mimeType: 'image/jpeg',
      bytes
    }
  } catch {
    return null
  }
}
