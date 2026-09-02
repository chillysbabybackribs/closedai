import type { BrowserDownload } from '../shared/types.js'

// Pure selection/formatting for the downloads shelf, split from the component (same split as
// browser-handoff-model.ts) so the rules that decide WHEN the shelf appears and WHAT each row
// reads are unit-testable without mounting React.

/** Bytes rendered the way a file manager renders them: no decimals below MB, one above. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${power >= 2 ? value.toFixed(1) : Math.round(value)} ${units[power]}`
}

/**
 * Progress as a 0-100 number, or null when the server sent no Content-Length. Null is the
 * signal to render an indeterminate bar rather than a misleading 0%.
 */
export function progressPercent(download: BrowserDownload): number | null {
  if (download.state === 'completed') return 100
  if (download.totalBytes <= 0) return null
  return Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100))
}

/**
 * The one line under a filename. Deliberately never shows a speed or an ETA for a settled
 * download — a finished row reporting "2.1 MB/s" reads as though it is still running.
 */
export function downloadDetail(download: BrowserDownload): string {
  const received = formatBytes(download.receivedBytes)
  switch (download.state) {
    case 'completed':
      return `${formatBytes(download.totalBytes || download.receivedBytes)} — ${download.relativePath || download.filename}`
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return download.error ?? 'Interrupted'
    case 'paused':
      return download.totalBytes > 0 ? `Paused — ${received} of ${formatBytes(download.totalBytes)}` : `Paused — ${received}`
    default:
      return progressLine(download, received)
  }
}

function progressLine(download: BrowserDownload, received: string): string {
  const total = download.totalBytes > 0 ? ` of ${formatBytes(download.totalBytes)}` : ''
  const speed = download.bytesPerSecond > 0 ? ` — ${formatBytes(download.bytesPerSecond)}/s` : ''
  return `${received}${total}${speed}`
}

/** Which controls a row offers. Keeps the component free of state branching. */
export function downloadActions(download: BrowserDownload): {
  canPause: boolean
  canResume: boolean
  canCancel: boolean
  canReveal: boolean
} {
  const running = download.state === 'progressing'
  return {
    canPause: running,
    canResume: download.state === 'paused' || (download.state === 'interrupted' && download.canResume),
    canCancel: running || download.state === 'paused',
    canReveal: download.state === 'completed'
  }
}

/** True when anything is still moving — the shelf stays open on its own while it is. */
export function hasActiveDownload(downloads: BrowserDownload[]): boolean {
  return downloads.some((download) => download.state === 'progressing' || download.state === 'paused')
}
