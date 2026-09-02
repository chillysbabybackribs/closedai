import type { MenuItemConstructorOptions } from 'electron'

export type LinkContextMenuActions = {
  openInCurrentTab?: (url: string) => void
  openInNewTab: (url: string) => void
  /** Only the embedded browser can download; the app shell omits this. */
  saveAs?: (url: string) => void
  copyAddress?: (url: string) => void
}

// Shared by the app-shell and embedded-browser native menus so link actions keep the
// same wording and ordering across the two WebContents surfaces.
export function linkContextMenuItems(
  url: string,
  actions: LinkContextMenuActions
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (actions.openInCurrentTab) {
    items.push({ label: 'Open link', click: () => actions.openInCurrentTab?.(url) })
  }
  items.push({ label: 'Open link in new tab', click: () => actions.openInNewTab(url) })
  // Chrome's order: the save action sits between the open actions and the copy action.
  if (actions.saveAs) {
    items.push({ label: 'Save link as…', click: () => actions.saveAs?.(url) })
  }
  if (actions.copyAddress) {
    items.push({ label: 'Copy link address', click: () => actions.copyAddress?.(url) })
  }
  return items
}
