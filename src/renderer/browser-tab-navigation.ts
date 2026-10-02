import type { BrowserTabInfo } from '../shared/types.js'

function rovingIndex(key: string, currentIndex: number, count: number, forward: string, backward: string): number | null {
  if (count <= 0) return null
  if (key === forward) return (currentIndex + 1) % count
  if (key === backward) return (currentIndex - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Horizontal roving across the tab strip. */
export function tabIndexForKey(key: string, currentIndex: number, count: number): number | null {
  return rovingIndex(key, currentIndex, count, 'ArrowRight', 'ArrowLeft')
}

/** Vertical roving inside a tab's context menu. */
export function menuIndexForKey(key: string, currentIndex: number, count: number): number | null {
  return rovingIndex(key, currentIndex, count, 'ArrowDown', 'ArrowUp')
}

/** ContextMenu key or Shift+F10 opens a focused tab's menu without a pointer. */
export function opensContextMenu(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
}

/** The panel a tab controls: app-owned viewers have their own; web tabs share the native page host. */
export function tabPanelId(tab: Pick<BrowserTabInfo, 'id' | 'image' | 'video' | 'videoHub' | 'file'>): string {
  return tab.image ? `image-page-${tab.id}` : tab.videoHub ? `video-home-${tab.id}` : tab.video ? `video-page-${tab.id}` : tab.file ? `file-page-${tab.id}` : 'browser-page'
}
