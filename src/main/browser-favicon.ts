export function selectFavicon(favicons: readonly string[]): string | null {
  for (const favicon of favicons) {
    try {
      const url = new URL(favicon)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
    } catch {
      // Ignore malformed favicon candidates and keep looking for a usable URL.
    }
  }
  return null
}
