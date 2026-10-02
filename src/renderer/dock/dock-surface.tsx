import type { JSX, ReactNode } from 'react'

/** Shared local backing for workspace navigation, app icons and status controls. */
export function DockSurface({ children }: { children: ReactNode }): JSX.Element {
  return <div data-slot="dock-control-cluster" className="dock-bar-controls" role="group" aria-label="Workspace controls">
    {children}
  </div>
}
