import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { BrowserState } from '../../shared/types.js'
import type { FileTabContent, FileTabIdentity } from '../../shared/local-files.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB preview limit

export class FileTab extends EventEmitter {
  private customTitle: string | null = null
  private cachedContent: string | null = null

  constructor(
    readonly id: string,
    readonly key: string,
    readonly info: { path: string; name: string; line?: number; endLine?: number },
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
      ...(line ? { line } : {}),
      ...(endLine ? { endLine } : {})
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

  async readContent(): Promise<FileTabContent> {
    const { path, name, line, endLine } = this.info
    if (this.cachedContent !== null) {
      return { path, name, content: this.cachedContent, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) }
    }
    const buffer = await readFile(path)
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`File is too large to preview (${Math.round(buffer.length / 1024 / 1024)} MB). Max supported is 5 MB.`)
    }
    const sample = buffer.subarray(0, Math.min(8000, buffer.length))
    if (sample.includes(0)) {
      throw new Error('Binary file cannot be previewed as text.')
    }
    this.cachedContent = buffer.toString('utf8')
    return { path, name, content: this.cachedContent, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) }
  }
}
