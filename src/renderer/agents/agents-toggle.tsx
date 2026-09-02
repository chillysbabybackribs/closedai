import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentsController } from './agents-controller.js'

export function AgentsToggle({ controller }: { controller: AgentsController }): JSX.Element {
  const collapsed = controller.isCollapsed
  return (
    <button
      type="button"
      className="agents-titlebar-toggle"
      onClick={controller.toggleCollapsed}
      title={collapsed ? 'Open agents sidebar' : 'Close agents sidebar'}
      aria-label={collapsed ? 'Open agents sidebar' : 'Close agents sidebar'}
      aria-pressed={!collapsed}
    >
      {collapsed
        ? <ChevronRight size={18} strokeWidth={1.6} />
        : <ChevronLeft size={18} strokeWidth={1.6} />}
    </button>
  )
}
