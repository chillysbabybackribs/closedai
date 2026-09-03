import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DrawerController } from './drawer-controller.js'

export function DrawerToggle({ controller }: { controller: DrawerController }): JSX.Element {
  const collapsed = controller.isCollapsed
  return (
    <button
      type="button"
      className="agents-titlebar-toggle"
      onClick={controller.toggleCollapsed}
      title={collapsed ? 'Open side drawer' : 'Close side drawer'}
      aria-label={collapsed ? 'Open side drawer' : 'Close side drawer'}
      aria-pressed={!collapsed}
      data-ui="titlebar.drawer-toggle"
    >
      {collapsed
        ? <ChevronRight size={18} strokeWidth={1.6} />
        : <ChevronLeft size={18} strokeWidth={1.6} />}
    </button>
  )
}
