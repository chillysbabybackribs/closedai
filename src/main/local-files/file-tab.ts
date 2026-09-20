import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { open } from 'node:fs/promises'
import type { BrowserState } from '../../shared/types.js'
import type { FileTabContent, FileTabIdentity } from '../../shared/local-files.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB preview limit

export class FileTab extends EventEmitter {
  private customTitle: string | null = null
  private cachedContent: string | null = null
  private revision = 0

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
      revision: this.revision,
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

  async readContent(): Promise<FileTabContent> {
    const { path, name, line, endLine } = this.info
    if (this.cachedContent !== null) {
      return { path, name, content: this.cachedContent, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) }
    }
    const revision = this.revision
    const file = await open(path, 'r')
    let buffer: Buffer
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error('This file type cannot be previewed.')
      if (info.size > MAX_FILE_BYTES) throw new Error('File is too large to preview. Max supported is 5 MB.')
      const bytes = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, null)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length > info.size) throw new Error('The file changed while opening. Try again.')
      buffer = bytes.subarray(0, length)
    } finally { await file.close() }
    const sample = buffer.subarray(0, Math.min(8000, buffer.length))
    if (sample.includes(0)) {
      throw new Error('Binary file cannot be previewed as text.')
    }
    const content = buffer.toString('utf8')
    if (revision === this.revision) this.cachedContent = content
    return { path, name, content, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) }
  }
}
