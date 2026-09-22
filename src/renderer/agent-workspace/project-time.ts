// Prototype-only time formatting for the Project shell preview. Every artifact carries a
// timestamp; these helpers keep the rendering short and consistent: relative when recent,
// clock time today, date and time otherwise.

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dated = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const full = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString()

/** Short relative form: "just now", "4m ago", "2h ago"; falls back to the clock beyond a day. */
export function relative(at: number, now: number): string {
  const gap = Math.max(0, now - at)
  if (gap < MINUTE) return 'just now'
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)}m ago`
  if (gap < 24 * HOUR) return `${Math.floor(gap / HOUR)}h ago`
  return absolute(at, now)
}

/** Clock time today, otherwise date and time. */
export function absolute(at: number, now: number): string {
  return sameDay(at, now) ? clock.format(at) : dated.format(at)
}

/** Both forms for a detail header: "12:14 AM · 3m ago". */
export function stamp(at: number, now: number): string {
  const rel = relative(at, now)
  const abs = absolute(at, now)
  return rel === abs ? abs : `${abs} · ${rel}`
}

/** Full date and time for written records, where "today" means nothing once the file is old. */
export function documentStamp(at: number): string {
  return full.format(at)
}

export function dayLabel(at: number): string {
  return dateOnly.format(at)
}

/** Length of an absence in words: "12 minutes", "3 hours", "2 days". */
export function duration(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(ms / HOUR)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(ms / (24 * HOUR))
  return `${days} day${days === 1 ? '' : 's'}`
}
