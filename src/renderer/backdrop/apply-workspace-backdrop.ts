import type { PreparedBackdrop } from './backdrop-image.js'
import { backdropTone, railTint } from './backdrop-tone.js'
import type { WorkspaceBackdrop } from '../../shared/backdrop-presets.js'

const ROOT_PROPERTIES = [
  '--backdrop-image',
  '--backdrop-blur',
  '--backdrop-dim',
  '--backdrop-glass',
  '--backdrop-rail-top',
  '--backdrop-rail-bottom',
  '--backdrop-accent'
] as const

export function applyWorkspaceBackdrop(root: HTMLElement, mode: WorkspaceBackdrop, backdrop: PreparedBackdrop): void {
  const tone = backdropTone(backdrop.luminance)
  root.style.setProperty('--backdrop-image', `url("${backdrop.image}")`)
  root.style.setProperty('--backdrop-blur', `url("${backdrop.blurred}")`)
  root.style.setProperty('--backdrop-dim', String(tone.dim))
  root.style.setProperty('--backdrop-glass', String(tone.glass))
  root.style.setProperty('--backdrop-rail-top', String(railTint(backdrop.topLuminance)))
  root.style.setProperty('--backdrop-rail-bottom', String(railTint(backdrop.bottomLuminance)))
  if (backdrop.accent) root.style.setProperty('--backdrop-accent', backdrop.accent)
  else root.style.removeProperty('--backdrop-accent')
  root.dataset.backdrop = mode
}

export function clearWorkspaceBackdrop(root: HTMLElement): void {
  delete root.dataset.backdrop
  for (const property of ROOT_PROPERTIES) root.style.removeProperty(property)
}
