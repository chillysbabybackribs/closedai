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
  path = stripLocalFileLineSuffix(path)
  return path.startsWith('/') && !path.startsWith('//') && !/[\u0000-\u001f]/.test(path) ? path : null
}

const WORKSPACE_FILE_EXT = /\.(md|markdown|tsx?|jsx?|mjs|cjs|json|ya?ml|css|scss|html?|py|rs|go|java|kt|swift|rb|php|sh|toml|xml|svg|txt|csv|tsv|vue|svelte|sql|graphql|proto|lock)$/i

/** Path + optional line suffix before cwd resolution (absolute or workspace-relative). */
export function splitLocalFileHref(value: string | undefined): { pathPart: string; line?: number; endLine?: number } | null {
  if (!value || /[\u0000-\u001f]/.test(value)) return null
  let raw = value
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw)
      if (url.hostname || url.search) return null
      raw = decodeURIComponent(url.pathname) + url.hash
    } catch { return null }
  }
  const range = raw.match(/#L(\d+)(?:-L?(\d+))?$/)
  const compiler = range ? null : raw.match(/:(\d+)(?::\d+)?$/)
  const match = range ?? compiler
  const pathPart = stripLocalFileLineSuffix(raw)
  if (!pathPart || pathPart.startsWith('//')) return null
  if (!match) return { pathPart }
  const line = parseInt(match[1]!, 10)
  const endLine = match[2] ? parseInt(match[2], 10) : undefined
  if (!(line > 0)) return { pathPart }
  return endLine !== undefined && endLine > line ? { pathPart, line, endLine } : { pathPart, line }
}

export function isWorkspaceFileHref(value: string | undefined): boolean {
  if (!value || localFilePath(value)) return Boolean(localFilePath(value))
  const split = splitLocalFileHref(value)
  if (!split) return false
  const part = split.pathPart
  if (/^https?:\/\//i.test(part) || /^www\./i.test(part)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(part)) return false
  if (/[\s<>|"']/.test(part)) return false
  if (part.startsWith('./') || part.startsWith('../')) return true
  if (part.includes('/')) return true
  return WORKSPACE_FILE_EXT.test(part)
}

function stripLocalFileLineSuffix(pathValue: string): string {
  return pathValue.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, '')
}

export function parseLocalFileTarget(value: string | undefined): { path: string; line?: number; endLine?: number } | null {
  const cleanPath = localFilePath(value)
  if (!cleanPath) return null
  const split = splitLocalFileHref(value)
  if (!split) return { path: cleanPath }
  return {
    path: cleanPath,
    ...(split.line ? { line: split.line } : {}),
    ...(split.endLine ? { endLine: split.endLine } : {})
  }
}

export type LocalFileOpenOptions = {
  /** Chat cwd used to resolve workspace-relative links such as `src/foo.ts`. */
  cwd?: string
  /** When set, the browser file tab shows this unified diff instead of plain text. */
  diff?: string
}

export type LocalFilePreview =
  | { kind: 'image'; name: string; src: string; path: string }
  | { kind: 'file'; path: string; line?: number; endLine?: number; cwd?: string; diff?: string }
  | { kind: 'revealed' }

export type LocalFileResult =
  | { kind: 'image'; tabId: string }
  | { kind: 'file'; tabId: string }
  | { kind: 'revealed' }
export type ImageTabContent = { name: string; src: string; path?: string }
export type ImageTabIdentity = { tabId: string; name: string; path?: string }
export type FileTabIdentity = {
  tabId: string
  name: string
  path: string
  revision: number
  line?: number
  endLine?: number
  cwd?: string
  diff?: string
}
export type FileTabContent = { name: string; path: string; content: string; line?: number; endLine?: number; cwd?: string; diff?: string }
