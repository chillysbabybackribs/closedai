import type { JSX } from 'react'

/**
 * The dock's surface: a flat strip a step above the workspace it covers, with one hairline along
 * its top edge. The tray's tiles stand out of it.
 */
export function DockSurface(): JSX.Element {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 border-t border-[var(--hairline-strong)]">
    <div data-slot="dock-surface-fill" className="absolute inset-0 bg-popover/85 backdrop-blur-md" />
  </div>
}
