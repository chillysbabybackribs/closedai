import type { BackdropPresetId } from '../../shared/backdrop-presets.js'
import auroraUrl from './presets/aurora.jpg'
import duskUrl from './presets/dusk.jpg'
import oceanUrl from './presets/ocean.jpg'
import emberUrl from './presets/ember.jpg'

const PRESET_URLS: Record<BackdropPresetId, string> = {
  aurora: auroraUrl,
  dusk: duskUrl,
  ocean: oceanUrl,
  ember: emberUrl
}

export function presetAssetUrl(id: BackdropPresetId): string {
  return PRESET_URLS[id]
}
