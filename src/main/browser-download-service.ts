import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { BrowserDownload, BrowserDownloadState } from '../shared/types.js'
import { safeDownloadFilename, uniqueDownloadPath } from './browser-download-names.js'

// The inbound half of the browser's disk traffic. Before this existed, any response Chromium
// could not render inline (Content-Disposition: attachment, a .zip, most octet-streams) fell
// through to Electron's default: a raw OS save dialog, with the navigation aborting behind it
// and being swallowed as benign in browser-tab.ts. The file was invisible to the app, to the
// UI, and to the agent.
//
// Two rules shape this module:
//
//  1. No OS dialog, ever. setSavePath is only legal synchronously inside the will-download
//     callback, so the whole path decision (sanitize, dedupe, mkdir) has to be sync too. That
//     is why this reaches for existsSync/mkdirSync rather than fs/promises.
//  2. Confined like every other disk writer here. Files land in <active chat cwd>/.downloads,
//     matching the .media / .captures / .workers convention, so a download is workspace-
//     relative and reportable the same way browser_batch_fetch_to_file's output is.

/** Structural shape of Electron's DownloadItem — see electron.d.ts:8107. */
export type DownloadItemLike = {
  getFilename(): string
  getURL(): string
  getMimeType(): string
  getTotalBytes(): number
  getReceivedBytes(): number
  getCurrentBytesPerSecond(): number
  getState(): 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  getSavePath(): string
  setSavePath(path: string): void
  isPaused(): boolean
  canResume(): boolean
  pause(): void
  resume(): void
  cancel(): void
  on(event: 'updated' | 'done', listener: (event: unknown, state: string) => void): unknown
}

/** Structural shape of the slice of Electron's Session this needs — see electron.d.ts:12831. */
export type DownloadSessionLike = {
  on(
    event: 'will-download',
    listener: (event: unknown, item: DownloadItemLike, webContents: unknown) => void
  ): unknown
}

export type DownloadServiceDeps = {
  /** Active chat's cwd, resolved per download so a chat switch retargets the folder. */
  workspaceRoot: () => string
  /** Injected so tests never touch a real filesystem. */
  fs?: { existsSync: (path: string) => boolean; mkdirSync: (path: string) => void }
  /** Injected so tests can assert coalescing without waiting on wall-clock time. */
  scheduleFlush?: (flush: () => void, ms: number) => { cancel: () => void }
}

/** Folder name under the workspace root, matching the dot-prefixed convention. */
export const DOWNLOAD_DIR = '.downloads'
/** Trailing-edge window for progress pushes, matching JournalFeed's EVENT_FLUSH_MS. */
const FLUSH_MS = 250
/** Enough history to be useful in the shelf without growing without bound in a long session. */
const MAX_RECORDS = 100

type Tracked = { record: BrowserDownload; item: DownloadItemLike }

/**
 * Owns every download in the persist:browser session. Emits 'changed' with the full list;
 * index.ts forwards that to the renderer, exactly like BrowserService's 'tabs'.
 */
export class BrowserDownloadService extends EventEmitter {
  private readonly tracked: Tracked[] = []
  private readonly fs: { existsSync: (path: string) => boolean; mkdirSync: (path: string) => void }
  private readonly scheduleFlush: (flush: () => void, ms: number) => { cancel: () => void }
  private pendingFlush: { cancel: () => void } | null = null
  private counter = 0

  constructor(private readonly deps: DownloadServiceDeps) {
    super()
    this.fs = deps.fs ?? {
      existsSync,
      mkdirSync: (path) => { mkdirSync(path, { recursive: true }) }
    }
    this.scheduleFlush = deps.scheduleFlush ?? ((flush, ms) => {
      const timer = setTimeout(flush, ms)
      timer.unref?.()
      return { cancel: () => clearTimeout(timer) }
    })
  }

  /** Attach to the session. Call once per partition session. */
  install(target: DownloadSessionLike): void {
    target.on('will-download', (_event, item) => this.accept(item))
  }

  /** Newest first, which is the order the shelf renders. */
  list(): BrowserDownload[] {
    return this.tracked.map((entry) => entry.record).reverse()
  }

  pause(id: string): void {
    this.withItem(id, (item) => { if (!item.isPaused()) item.pause() })
  }

  resume(id: string): void {
    this.withItem(id, (item) => { if (item.canResume()) item.resume() })
  }

  cancel(id: string): void {
    this.withItem(id, (item) => item.cancel())
  }

  /** Absolute path for an id, or null when the download is gone or never settled. */
  pathFor(id: string): string | null {
    const entry = this.tracked.find((candidate) => candidate.record.id === id)
    return entry && entry.record.state === 'completed' ? entry.record.path : null
  }

  /** Drop settled rows; anything still running stays so the user cannot lose sight of it. */
  clear(): void {
    const keep = this.tracked.filter((entry) => entry.record.state === 'progressing')
    this.tracked.length = 0
    this.tracked.push(...keep)
    this.flush()
  }

  private withItem(id: string, apply: (item: DownloadItemLike) => void): void {
    const entry = this.tracked.find((candidate) => candidate.record.id === id)
    if (!entry) return
    apply(entry.item)
    this.sync(entry)
    this.flush()
  }

  /**
   * The will-download callback. Everything here must stay synchronous up to and including
   * setSavePath — one await and Electron shows the save dialog instead.
   */
  private accept(item: DownloadItemLike): void {
    const target = this.choosePath(item)
    if (target) item.setSavePath(target)
    this.counter += 1
    const root = resolve(this.deps.workspaceRoot())
    const path = target ?? ''
    const entry: Tracked = {
      item,
      record: {
        id: `dl-${this.counter}`,
        url: safeText(() => item.getURL()),
        filename: path ? path.slice(path.lastIndexOf('/') + 1) : safeDownloadFilename(safeText(() => item.getFilename())),
        path,
        relativePath: path ? relative(root, path) : '',
        mimeType: safeText(() => item.getMimeType()),
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: numberOr(() => item.getTotalBytes(), 0),
        bytesPerSecond: 0,
        canResume: false,
        error: null
      }
    }
    this.tracked.push(entry)
    if (this.tracked.length > MAX_RECORDS) this.tracked.splice(0, this.tracked.length - MAX_RECORDS)
    item.on('updated', () => { this.sync(entry); this.schedule() })
    // A terminal state must never sit behind the coalescing window: the row's final size,
    // path, and error are what the user and the agent act on.
    item.on('done', () => { this.sync(entry); this.flush() })
    this.flush()
  }

  /** Resolve the save path, or null to let Electron fall back to its dialog. */
  private choosePath(item: DownloadItemLike): string | null {
    try {
      const dir = join(resolve(this.deps.workspaceRoot()), DOWNLOAD_DIR)
      this.fs.mkdirSync(dir)
      const name = safeDownloadFilename(safeText(() => item.getFilename()))
      return uniqueDownloadPath(dir, name, this.fs.existsSync)
    } catch {
      // An unwritable workspace is not a reason to lose the download; the dialog still works.
      return null
    }
  }

  /** Re-read the item into its record. Electron mutates the item, so this always re-reads. */
  private sync(entry: Tracked): void {
    const { record, item } = entry
    const state = mapState(safeText(() => item.getState()), () => item.isPaused())
    record.state = state
    record.receivedBytes = numberOr(() => item.getReceivedBytes(), record.receivedBytes)
    record.totalBytes = numberOr(() => item.getTotalBytes(), record.totalBytes)
    record.bytesPerSecond = state === 'progressing' ? numberOr(() => item.getCurrentBytesPerSecond(), 0) : 0
    record.canResume = state === 'interrupted' || state === 'paused'
      ? booleanOr(() => item.canResume(), false)
      : false
    const savePath = safeText(() => item.getSavePath())
    if (savePath) {
      record.path = savePath
      record.relativePath = relative(resolve(this.deps.workspaceRoot()), savePath)
      record.filename = savePath.slice(savePath.lastIndexOf('/') + 1)
    }
    record.error = state === 'interrupted' ? 'The transfer was interrupted' : null
  }

  private schedule(): void {
    if (this.pendingFlush) return
    this.pendingFlush = this.scheduleFlush(() => {
      this.pendingFlush = null
      this.emit('changed', this.list())
    }, FLUSH_MS)
  }

  private flush(): void {
    this.pendingFlush?.cancel()
    this.pendingFlush = null
    this.emit('changed', this.list())
  }
}

/** Electron getters throw once an item is destroyed; a stale row must not crash the pipeline. */
function safeText(read: () => string): string {
  try {
    return read() || ''
  } catch {
    return ''
  }
}

function numberOr(read: () => number, fallback: number): number {
  try {
    const value = read()
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function booleanOr(read: () => boolean, fallback: boolean): boolean {
  try {
    return read()
  } catch {
    return fallback
  }
}

/**
 * Electron reports paused downloads as 'progressing' with a separate isPaused() flag; the UI
 * needs them distinct, so 'paused' is promoted to a first-class state here.
 */
function mapState(raw: string, isPaused: () => boolean): BrowserDownloadState {
  if (raw === 'completed' || raw === 'cancelled' || raw === 'interrupted') return raw
  return booleanOr(isPaused, false) ? 'paused' : 'progressing'
}
