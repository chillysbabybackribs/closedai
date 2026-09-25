import type { AppIconId } from '../../app-icons.js'
import { dockedGroups } from '../layout-docking.js'
import type { ChatLayout } from '../layout-tree.js'
import { parseViewTab } from '../layout-views.js'

/** A window waiting in the dock: its front tab names it, and a view shows its own icon. */
export type MinimizedWindow = { id: string; title: string; tabs: number; icon: AppIconId }

export function minimizedWindows(tree: ChatLayout, title: (id: string) => string): MinimizedWindow[] {
  return dockedGroups(tree).map((group) => ({
    id: group.id,
    title: title(group.id),
    tabs: (group.tabs ?? [group.id]).length,
    icon: parseViewTab(group.id)?.kind ?? 'chats'
  }))
}
