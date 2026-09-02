import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SESSION_COOKIE_RETENTION_SECONDS,
  toPersistentCookieDetails
} from './persistent-session-cookies.ts'

test('session cookies are promoted with a durable expiration', () => {
  const details = toPersistentCookieDetails(
    {
      name: '__session',
      value: 'secret',
      domain: '.higgsfield.ai',
      path: '/',
      secure: true,
      httpOnly: true,
      hostOnly: false,
      session: true,
      sameSite: 'lax'
    },
    1_000
  )

  assert.deepEqual(details, {
    url: 'https://higgsfield.ai/',
    name: '__session',
    value: 'secret',
    domain: '.higgsfield.ai',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: 1_000 + SESSION_COOKIE_RETENTION_SECONDS
  })
})

test('host-only cookies stay host-only when promoted', () => {
  const details = toPersistentCookieDetails({
    name: 'session',
    value: 'value',
    domain: 'app.example.com',
    hostOnly: true,
    session: true,
    sameSite: 'unspecified'
  })

  assert.equal(details?.url, 'http://app.example.com/')
  assert.equal(details && 'domain' in details, false)
})

test('cookies without a usable domain are ignored', () => {
  assert.equal(
    toPersistentCookieDetails({
      name: 'session',
      value: 'value',
      session: true,
      sameSite: 'lax'
    }),
    null
  )
})
