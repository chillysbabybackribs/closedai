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

export type LocalFilePreview =
  | { kind: 'image'; name: string; src: string }
  | { kind: 'revealed' }

export type LocalFileResult = { kind: 'image'; tabId: string } | { kind: 'revealed' }
export type ImageTabContent = { name: string; src: string; path?: string }
export type ImageTabIdentity = { tabId: string; name: string; path?: string }
