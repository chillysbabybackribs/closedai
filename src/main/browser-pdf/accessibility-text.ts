/** Chromium's diagnostic formatter is an internal, version-sensitive interface.
 * Only the native pdfRoot subtree is evidence; viewer controls are not PDF text.
 * Keep this function self-contained: it also runs in the temporary WebUI reader.
 */
export function parseNativePdfTree(tree: string, page: number, maxChars: number) {
  let rootDepth = -1
  let pageDepth = -1
  let pagesAvailable = 0
  let totalPages: number | null = null
  let text = ''
  let truncated = false
  for (const line of tree.split('\n')) {
    const match = /^(\+*)(\w+)(?: name='(.*)')?$/.exec(line)
    if (!match) continue
    const depth = match[1].length
    const role = match[2]
    const name = match[3] ?? ''
    if (rootDepth < 0) {
      if (role !== 'pdfRoot') continue
      rootDepth = depth
      const count = /\d+/.exec(name)
      totalPages = count ? Number(count[0]) : null
      continue
    }
    if (depth <= rootDepth) break
    if (role === 'region' && depth === rootDepth + 2) {
      pagesAvailable++
      pageDepth = depth
    }
    if (pagesAvailable !== page || depth <= pageDepth || role !== 'staticText') continue
    const value = name.replaceAll('<newline>', '\n')
    const remaining = Math.max(0, maxChars - text.length)
    const chunk = value + '\n'
    text += chunk.slice(0, remaining)
    truncated ||= chunk.length > remaining
  }
  return {
    page, totalPages, pagesAvailable, available: pagesAvailable >= page,
    text: text.trim(), truncated, hasPdfRoot: rootDepth >= 0
  }
}

export type NativePdfText = ReturnType<typeof parseNativePdfTree>

export const PDF_VIEWER_URL = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'
