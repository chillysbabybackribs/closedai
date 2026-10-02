import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import type { BrowserState } from '../../shared/types.js'
import type { FileTabContent, FileTabIdentity } from '../../shared/local-files.js'
import { readFilePreview } from './read-file-preview.js'

export class FileTab extends EventEmitter {
  private customTitle: string | null = null
  private cachedContent: string | null = null
  private revision = 0

  constructor(
    readonly id: string,
    readonly key: string,
    readonly info: { path: string; name: string; line?: number; endLine?: number; cwd?: string; diff?: string },
    public previousTabId: string | null
  ) {
    super()
  }

  getState(): BrowserState {
    const { name, path, line, endLine } = this.info
    const hash = line ? (endLine ? `#L${line}-L${endLine}` : `#L${line}`) : ''
    const fileIdentity: FileTabIdentity = {
      tabId: this.id,
      name,
      path,
      revision: this.revision,
      ...(line ? { line } : {}),
      ...(endLine ? { endLine } : {}),
      ...(this.info.cwd ? { cwd: this.info.cwd } : {}),
      ...(this.info.diff ? { diff: this.info.diff } : {})
    }
    return {
      file: fileIdentity,
      url: `${pathToFileURL(path).href}${hash}`,
      title: name,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      navigationError: null
    }
  }

  getFavicon(): null { return null }
  getCustomTitle(): string | null { return this.customTitle }
  exportNavigationStack(): null { return null }

  rename(title: string | null): void {
    this.customTitle = title?.trim().slice(0, 300) || null
    this.emit('state')
  }

  reload(): void {
    this.cachedContent = null
    this.revision += 1
    this.emit('state')
  }

  dispose(): void {
    this.removeAllListeners()
  }

  updateLine(line?: number, endLine?: number): void {
    this.info.line = line
    this.info.endLine = endLine
    this.emit('state')
  }

  updateView(patch: { line?: number; endLine?: number; diff?: string; cwd?: string }): void {
    if (patch.line !== undefined) this.info.line = patch.line
    if (patch.endLine !== undefined) this.info.endLine = patch.endLine
    if (patch.diff !== undefined) this.info.diff = patch.diff
    if (patch.cwd !== undefined) this.info.cwd = patch.cwd
    this.emit('state')
  }

  async readContent(): Promise<FileTabContent> {
    const { path, name, line, endLine } = this.info
    if (this.cachedContent !== null) {
      return {
        path, name, content: this.cachedContent,
        ...(line ? { line } : {}),
        ...(endLine ? { endLine } : {}),
        ...(this.info.cwd ? { cwd: this.info.cwd } : {}),
        ...(this.info.diff ? { diff: this.info.diff } : {})
      }
    }
    const revision = this.revision
    const result = await readFilePreview(this.info)
    if (revision === this.revision && !this.info.diff) this.cachedContent = result.content
    return result
  }
}
