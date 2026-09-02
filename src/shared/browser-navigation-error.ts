import type { BrowserNavigationError } from './types.js'

type NavigationErrorCopy = Pick<BrowserNavigationError, 'title' | 'summary' | 'suggestions'>

const COPY_BY_CODE: Readonly<Record<string, NavigationErrorCopy>> = {
  ERR_NAME_NOT_RESOLVED: {
    title: 'This site can’t be reached',
    summary: 'The server address could not be found.',
    suggestions: ['Check the address for typing errors.', 'Check your DNS, proxy, VPN, or firewall settings.']
  },
  ERR_CONNECTION_REFUSED: {
    title: 'This site can’t be reached',
    summary: 'The server refused the connection.',
    suggestions: ['Check that the site is online.', 'Check your proxy, VPN, or firewall settings.']
  },
  ERR_CONNECTION_RESET: {
    title: 'The connection was reset',
    summary: 'The connection closed unexpectedly while the page was loading.',
    suggestions: ['Check your internet connection.', 'Check your proxy, VPN, or firewall settings.']
  },
  ERR_TIMED_OUT: {
    title: 'This site took too long to respond',
    summary: 'The connection timed out before the page could load.',
    suggestions: ['Check your internet connection.', 'Try again in a few moments.']
  },
  ERR_INTERNET_DISCONNECTED: {
    title: 'You’re offline',
    summary: 'AppV1 could not reach the internet.',
    suggestions: ['Check your network connection.', 'Reconnect, then try again.']
  },
  ERR_SSL_PROTOCOL_ERROR: {
    title: 'This site can’t provide a secure connection',
    summary: 'The server sent a response that Chromium could not negotiate securely.',
    suggestions: ['Check your system date and time.', 'Check your proxy, VPN, or security software.', 'The site may need to fix its TLS configuration.']
  },
  ERR_TOO_MANY_REDIRECTS: {
    title: 'This page isn’t working',
    summary: 'The site redirected the request too many times.',
    suggestions: ['Try again later.', 'The site may need to fix its redirect configuration.']
  },
  ERR_EMPTY_RESPONSE: {
    title: 'This page isn’t working',
    summary: 'The server closed the connection without sending any data.',
    suggestions: ['Try reloading the page.', 'Check your proxy, VPN, or firewall settings.']
  }
}

const CERTIFICATE_COPY: NavigationErrorCopy = {
  title: 'Your connection is not private',
  summary: 'Chromium could not verify the certificate presented by this site.',
  suggestions: ['Check your system date and time.', 'The site may need to renew or correct its certificate.']
}

const DEFAULT_COPY: NavigationErrorCopy = {
  title: 'This page couldn’t be loaded',
  summary: 'Chromium stopped the navigation before the page could open.',
  suggestions: ['Check your internet connection.', 'Try reloading the page.']
}

function normalizeCode(value?: string): string {
  const match = value?.toUpperCase().match(/(?:NET::)?(ERR_[A-Z0-9_]+)/)
  return match?.[1] ?? 'ERR_FAILED'
}

function errorCopy(code: string): NavigationErrorCopy {
  if (code.startsWith('ERR_CERT_')) return CERTIFICATE_COPY
  return COPY_BY_CODE[code] ?? DEFAULT_COPY
}

export function createBrowserNavigationError(input: {
  url: string
  previousUrl: string
  code?: string
  description?: string
  errno?: number | null
  at?: number
}): BrowserNavigationError {
  const code = normalizeCode(input.code ?? input.description)
  return {
    url: input.url,
    previousUrl: input.previousUrl,
    code,
    errno: input.errno ?? null,
    ...errorCopy(code),
    at: input.at ?? Date.now()
  }
}

export function createBrowserNavigationErrorFromMessage(
  message: string,
  url: string,
  previousUrl: string,
  at?: number
): BrowserNavigationError {
  const errnoMatch = message.match(/\((-?\d+)\)/)
  return createBrowserNavigationError({
    url,
    previousUrl,
    code: message,
    description: message,
    errno: errnoMatch ? Number(errnoMatch[1]) : null,
    at
  })
}
