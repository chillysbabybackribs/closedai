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

export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed
}
