import type { AgentWorkspaceBounds } from '../shared/types.js'

/**
 * Tracks the agent workspace pane's current on-screen rect, as reported by the renderer.
 * Unlike the browser it is plain DOM in the main window, not a native view, so there is
 * nothing to position here — this only remembers where to crop for the capture tool.
 */
export class AgentWorkspaceSurface {
  private bounds: AgentWorkspaceBounds | null = null

  setBounds(bounds: AgentWorkspaceBounds): void {
    this.bounds = bounds
  }

  current(): AgentWorkspaceBounds | null {
    return this.bounds
  }
}
