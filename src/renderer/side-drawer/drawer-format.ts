const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatChatTime(timestampMs: number, now = Date.now()): string {
  if (!timestampMs) return ''
  const elapsed = Math.max(0, now - timestampMs)
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`
  const date = new Date(timestampMs)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatMessageCount(count: number): string {
  if (count <= 0) return ''
  return count === 1 ? '1 message' : `${count} messages`
}

/**
 * Why a row refused to open, in the width a row has. Threads live in one `~/.codex` store shared by
 * every Codex client on the machine, so a thread held by another app (the ChatGPT desktop app, a
 * `codex` TUI) rejects with a writer conflict — a normal condition, not a fault, and the one case
 * worth naming precisely so the row does not read as broken.
 */
export function openFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/active writer|thread-store conflict/i.test(text)) return 'Open in another app'
  if (/not found|no such thread|missing/i.test(text)) return 'Thread unavailable'
  return 'Could not open'
}

/** A failure as the drawer footer shows it: the message itself, without Electron's IPC prefix. */
export function drawerErrorMessage(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*': /, '')
    .replace(/^\w*Error: /, '')
    .trim()
  const message = text || 'Something went wrong'
  return message.length > 140 ? `${message.slice(0, 139).trimEnd()}…` : message
}

export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed
}

/**
 * Format a live tool call, command, or background status for a running drawer row.
 * E.g. "Read file" with "/path/to/network-rules.ts" -> "Read network-rules.ts",
 * or "Run command" with "npm test" -> "Run npm test".
 */
export function formatLiveActivity(activity: string | null | undefined, preview?: string | null): string {
  if (!activity) return 'Running'
  const trimmedPreview = preview?.trim() ?? ''
  if (!trimmedPreview) return activity

  // If preview is a command, take the first short snippet
  if (/^run\b|command/i.test(activity)) {
    const singleLine = trimmedPreview.split('\n')[0]!.trim()
    const cleanCommand = singleLine
      .replace(/^(\/bin\/(?:bash|sh)\s+-lc\s+["']?|node\s+)/, '')
      .replace(/["']$/, '')
      .trim()
    const shortCmd = cleanCommand.length > 25 ? `${cleanCommand.slice(0, 24)}…` : cleanCommand
    return shortCmd ? `Run ${shortCmd}` : activity
  }

  // If preview looks like a file path, extract the basename
  if (/[/\\]/.test(trimmedPreview) && !trimmedPreview.includes('\n')) {
    const file = basename(trimmedPreview)
    if (file && file !== trimmedPreview) {
      if (/^read\b/i.test(activity)) return `Read ${file}`
      if (/^edit\b/i.test(activity)) return `Edit ${file}`
      if (/^write\b/i.test(activity)) return `Write ${file}`
      if (/^list\b/i.test(activity)) return `List ${file}`
      return `${activity} ${file}`
    }
  }

  return activity
}
