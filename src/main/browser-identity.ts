/**
 * Remove Electron and the app product token from the fallback UA before any
 * browser session is created. This preserves Chromium's native version and
 * native Client Hints instead of replacing the entire browser identity.
 */
export function browserUserAgentFallback(userAgent: string, applicationName: string): string {
  const applicationToken = applicationName.replace(/[^a-z0-9]/gi, '')
  const patterns = [
    /\sElectron\/\S+/gi,
    ...(applicationToken ? [new RegExp(`\\s${escapeRegExp(applicationToken)}\\/\\S+`, 'gi')] : [])
  ]
  return patterns.reduce((value, pattern) => value.replace(pattern, ''), userAgent)
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
