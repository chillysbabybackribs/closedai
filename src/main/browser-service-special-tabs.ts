import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allocateTabId, BrowserTab } from './browser-tab.js'
import { ImageTab, imageKey } from './local-files/image-tab.js'
import { FileTab } from './local-files/file-tab.js'
import { VideoTab, videoKey } from './local-files/video-tab.js'
import { VideoHubTab } from './local-files/video-hub-tab.js'
import {
  browserDocumentFilePath, isPdfFile, isRenderableFile, renderableFilePath, type FileView, type ImageTabContent,
  type VideoTabContent
} from '../shared/local-files.js'

type TabStrip = (BrowserTab | ImageTab | FileTab | VideoTab | VideoHubTab)[]

export function openVideoTab(
  tabs: TabStrip,
  activeId: string | null,
  content: VideoTabContent,
  register: (tab: VideoTab, index?: number) => void,
  setActive: (id: string) => void,
  emitState: (state: ReturnType<VideoTab['getState']>) => void
): string {
  const key = videoKey(content)
  const existing = tabs.find((tab) => tab instanceof VideoTab && tab.key === key)
  if (existing) {
    setActive(existing.id)
    emitState(existing.getState())
    return existing.id
  }
  const tab = new VideoTab(allocateTabId(), key, content, activeId)
  const index = tabs.findIndex((item) => item.id === activeId)
  register(tab, index + 1)
  setActive(tab.id)
  return tab.id
}

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
  register: (tab: ImageTab | FileTab | VideoTab, index?: number) => void,
  setActive: (id: string) => void,
  emitTabs: () => void
): boolean {
  const index = tabs.findIndex((tab) => tab.id === id)
  const tab = index === -1 ? null : tabs[index]
  if (!tab) return false
  if (tab instanceof VideoHubTab) return false
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
  if (tab instanceof VideoTab) {
    const duplicate = new VideoTab(allocateTabId(), tab.key, { ...tab.content }, activeId)
    duplicate.rename(tab.getCustomTitle())
    register(duplicate, index + 1)
    if (activate) setActive(duplicate.id)
    else emitTabs()
    return true
  }
  return false
}

export type FileViewHost = {
  tabs: TabStrip
  activeId: string | null
  /** Tear down a tab already spliced out of the strip, without choosing a successor. */
  retire: (tab: BrowserTab | FileTab) => void
  register: (tab: FileTab, index: number) => void
  openPage: (url: string, activate: boolean, index: number, id?: string) => BrowserTab
  setActive: (id: string) => void
  emitTabs: () => void
}

/** The web tab currently rendering the local file at `path`, if any. */
export function pageTabShowing(tabs: TabStrip, path: string): BrowserTab | null {
  return tabs.find((tab): tab is BrowserTab => tab instanceof BrowserTab && browserDocumentFilePath(tab.getState().url) === path) ?? null
}

/** A clicked HTML, SVG, or PDF file opens in a web tab; HTML/SVG tabs already in code view are reused. */
export function openFilePageTab(host: FileViewHost, path: string): string {
  const page = pageTabShowing(host.tabs, path)
  if (page) {
    host.setActive(page.id)
    return page.id
  }
  const fileTab = host.tabs.find((tab): tab is FileTab => tab instanceof FileTab && tab.key === path)
  if (fileTab) {
    if (isPdfFile(path)) {
      const index = host.tabs.indexOf(fileTab)
      const title = fileTab.getCustomTitle()
      const active = host.activeId === fileTab.id
      host.tabs.splice(index, 1)
      host.retire(fileTab)
      const tab = host.openPage(pathToFileURL(path).href, active, index, fileTab.id)
      tab.rename(title)
      return tab.id
    }
    host.setActive(fileTab.id)
    return fileTab.id
  }
  const index = host.tabs.findIndex((tab) => tab.id === host.activeId)
  return host.openPage(pathToFileURL(path).href, true, index + 1).id
}

/**
 * Show a renderable file's tab as its page or its code, in place: the same id and strip slot,
 * so the tab the user toggled (and any chat's claim on it) stays the same tab. The page is
 * loaded fresh from disk each time it is shown, so edits made while reading code appear.
 */
export function swapFileView(host: FileViewHost, id: string, view: FileView): void {
  const index = host.tabs.findIndex((tab) => tab.id === id)
  const tab = host.tabs[index]
  if (!tab) throw new Error('This tab is no longer open.')
  const active = host.activeId === id
  const title = tab.getCustomTitle()
  if (view === 'page') {
    if (tab instanceof BrowserTab) return
    if (!(tab instanceof FileTab) || tab.info.diff || !isRenderableFile(tab.info.path)) {
      throw new Error('Only local HTML and SVG files have a page view.')
    }
    host.tabs.splice(index, 1)
    host.retire(tab)
    host.openPage(pathToFileURL(tab.info.path).href, active, index, id).rename(title)
    return
  }
  if (tab instanceof FileTab) return
  const path = tab instanceof BrowserTab ? renderableFilePath(tab.getState().url) : null
  if (!(tab instanceof BrowserTab) || !path) throw new Error('Only local HTML and SVG pages have a code view.')
  host.tabs.splice(index, 1)
  host.retire(tab)
  const file = new FileTab(id, path, { path, name: basename(path) }, null)
  file.rename(title)
  host.register(file, index)
  if (active) host.setActive(id)
  else host.emitTabs()
}
