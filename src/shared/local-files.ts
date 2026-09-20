/** Explicit local links only; never interpret network paths or arbitrary schemes as files. */
export function localFilePath(value: string | undefined): string | null {
  if (!value || /[\u0000-\u001f]/.test(value)) return null
  let path = value
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path)
      if (url.hostname || url.search) return null
      path = decodeURIComponent(url.pathname) + url.hash
    } catch { return null }
  } else {
    if (!path.startsWith('/') || path.startsWith('//')) return null
    try { path = decodeURIComponent(path) } catch { return null }
  }
  path = path.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, '')
  return path.startsWith('/') && !path.startsWith('//') && !/[\u0000-\u001f]/.test(path) ? path : null
}

export function parseLocalFileTarget(value: string | undefined): { path: string; line?: number; endLine?: number } | null {
  const cleanPath = localFilePath(value)
  if (!cleanPath) return null
  if (!value) return { path: cleanPath }
  // `#L12-L15` is a line range; `:12:4` is the compiler form, line then column, never a range.
  const range = value.match(/#L(\d+)(?:-L?(\d+))?$/)
  const compiler = range ? null : value.match(/:(\d+)(?::\d+)?$/)
  const match = range ?? compiler
  if (!match) return { path: cleanPath }
  const line = parseInt(match[1]!, 10)
  const endLine = match[2] ? parseInt(match[2], 10) : undefined
  if (!(line > 0)) return { path: cleanPath }
  return endLine !== undefined && endLine > line ? { path: cleanPath, line, endLine } : { path: cleanPath, line }
}

export type LocalFilePreview =
  | { kind: 'image'; name: string; src: string }
  | { kind: 'file'; path: string; line?: number; endLine?: number }
  | { kind: 'revealed' }

export type LocalFileResult =
  | { kind: 'image'; tabId: string }
  | { kind: 'file'; tabId: string }
  | { kind: 'revealed' }
export type ImageTabContent = { name: string; src: string; path?: string }
export type ImageTabIdentity = { tabId: string; name: string; path?: string }
export type FileTabIdentity = { tabId: string; name: string; path: string; revision: number; line?: number; endLine?: number }
export type FileTabContent = { name: string; path: string; content: string; line?: number; endLine?: number }
