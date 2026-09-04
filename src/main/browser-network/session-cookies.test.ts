import assert from 'node:assert/strict'
import test from 'node:test'
import { listCookies, removeCookie, setCookie, urlForCookie, type CookieStore } from './session-cookies.js'

function store(initial: Electron.Cookie[] = []): CookieStore & { cookies: Electron.Cookie[]; calls: unknown[] } {
  const cookies = [...initial]
  const calls: unknown[] = []
  return {
    cookies,
    calls,
    get: async (filter) => {
      calls.push(['get', filter])
      return cookies.filter((cookie) =>
        (!filter.name || cookie.name === filter.name) &&
        (!filter.domain || (cookie.domain ?? '').endsWith(filter.domain.replace(/^\./, ''))) &&
        (!filter.url || new URL(filter.url).hostname.endsWith((cookie.domain ?? '').replace(/^\./, '')))
      )
    },
    set: async (details) => {
      calls.push(['set', details])
      cookies.push({ name: details.name ?? '', value: details.value ?? '', domain: details.domain ?? new URL(details.url).hostname, path: details.path ?? '/', secure: details.secure ?? false, httpOnly: details.httpOnly ?? false, session: details.expirationDate === undefined, expirationDate: details.expirationDate, sameSite: details.sameSite ?? 'unspecified', hostOnly: false })
    },
    remove: async (url, name) => {
      calls.push(['remove', url, name])
      for (let index = cookies.length - 1; index >= 0; index -= 1) if (cookies[index].name === name) cookies.splice(index, 1)
    }
  }
}

const existing: Electron.Cookie = { name: 'sid', value: 'abc', domain: '.a.test', path: '/', secure: true, httpOnly: true, session: false, expirationDate: 1_900_000_000, sameSite: 'lax', hostOnly: false }

test('listCookies filters through the store and reports the total before the limit', async () => {
  const cookies = store([existing, { ...existing, name: 'theme', value: 'dark', domain: 'b.test' }])
  const byDomain = await listCookies(cookies, { domain: 'a.test', limit: 10 })
  assert.equal(byDomain.matched, 1)
  assert.equal(byDomain.cookies[0].expiresAt, new Date(1_900_000_000 * 1000).toISOString())
  const limited = await listCookies(cookies, { limit: 1 })
  assert.deepEqual([limited.matched, limited.cookies.length], [2, 1])
})

test('setCookie derives a URL from the domain and returns what the store holds', async () => {
  const cookies = store()
  const written = await setCookie(cookies, { name: 'flag', value: '1', domain: '.a.test', path: '/app', expiresAt: 2_000_000_000, sameSite: 'strict' })
  assert.deepEqual(cookies.calls[0], ['set', { url: 'https://a.test/app', name: 'flag', value: '1', domain: '.a.test', path: '/app', expirationDate: 2_000_000_000, sameSite: 'strict' }])
  assert.equal(written.name, 'flag')
  assert.equal(written.session, false)
  await assert.rejects(setCookie(cookies, { name: 'x', value: 'y' }), /url.*or.*domain/)
})

test('removeCookie reports how many cookies went away', async () => {
  const cookies = store([existing])
  assert.deepEqual(await removeCookie(cookies, { domain: 'a.test', name: 'sid' }), { removed: 1 })
  assert.deepEqual(await removeCookie(cookies, { url: 'https://a.test/', name: 'sid' }), { removed: 0 })
})

test('urlForCookie mirrors browser defaults', () => {
  assert.equal(urlForCookie('.a.test', undefined, undefined), 'https://a.test/')
  assert.equal(urlForCookie('a.test', '/p', false), 'http://a.test/p')
  assert.equal(urlForCookie(undefined, undefined, undefined), null)
})
