import { allocateTabId } from './browser-tab.js'
import { ImageTab, imageKey } from './local-files/image-tab.js'
import { FileTab } from './local-files/file-tab.js'
import type { ImageTabContent } from '../shared/local-files.js'
import type { BrowserTab } from './browser-tab.js'

type TabStrip = (BrowserTab | ImageTab | FileTab)[]

export function openImageTab(
  tabs: TabStrip,
  activeId: string | null,
  content: ImageTabContent,
  register: (tab: ImageTab, index?: number) => void,
  setActive: (id: string) => void,
  emitState: (state: ReturnType<ImageTab['getState']>) => void
): string {
  const key = imageKey(content)
  const existing = tabs.find((tab) => tab instanceof ImageTab && tab.key === key)
  if (existing) {
    setActive(existing.id)
    emitState(existing.getState())
    return existing.id
  }
  const tab = new ImageTab(allocateTabId(), key, content, activeId)
  const index = tabs.findIndex((item) => item.id === activeId)
  register(tab, index + 1)
  setActive(tab.id)
  return tab.id
}

export function openFileViewerTab(
  tabs: TabStrip,
  activeId: string | null,
  content: { path: string; name: string; line?: number; endLine?: number; cwd?: string; diff?: string },
  register: (tab: FileTab, index?: number) => void,
  setActive: (id: string) => void,
  emitState: (state: ReturnType<FileTab['getState']>) => void
): string {
  const existing = tabs.find((tab) => tab instanceof FileTab && tab.key === content.path)
  if (existing instanceof FileTab) {
    existing.updateView({ line: content.line, endLine: content.endLine, diff: content.diff, cwd: content.cwd })
    setActive(existing.id)
    emitState(existing.getState())
    return existing.id
  }
  const tab = new FileTab(allocateTabId(), content.path, content, activeId)
  const index = tabs.findIndex((item) => item.id === activeId)
  register(tab, index + 1)
  setActive(tab.id)
  return tab.id
}

export function duplicateSpecialTab(
  tabs: TabStrip,
  id: string,
  activeId: string | null,
  activate: boolean,
  register: (tab: ImageTab | FileTab, index?: number) => void,
  setActive: (id: string) => void,
  emitTabs: () => void
): boolean {
  const index = tabs.findIndex((tab) => tab.id === id)
  const tab = index === -1 ? null : tabs[index]
  if (!tab) return false
  if (tab instanceof ImageTab) {
    const duplicate = new ImageTab(allocateTabId(), tab.key, tab.content, activeId)
    duplicate.rename(tab.getCustomTitle())
    register(duplicate, index + 1)
    if (activate) setActive(duplicate.id)
    else emitTabs()
    return true
  }
  if (tab instanceof FileTab) {
    const duplicate = new FileTab(allocateTabId(), tab.key, { ...tab.info }, activeId)
    duplicate.rename(tab.getCustomTitle())
    register(duplicate, index + 1)
    if (activate) setActive(duplicate.id)
    else emitTabs()
    return true
  }
  return false
}
