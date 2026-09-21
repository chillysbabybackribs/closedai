import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ConnectionBanner, EmptyState, connectionHeading } from './chat-connection.tsx'

const noop = () => {}
const login = async () => {}

test('the heading names the step between the user and a first message', () => {
  assert.equal(connectionHeading('codex', 'signed-out'), 'Sign in to Codex')
  assert.equal(connectionHeading('claude', 'unavailable'), 'Claude Code is unavailable')
  assert.equal(connectionHeading('cursor', 'error'), 'Cursor is unavailable')
  assert.equal(connectionHeading('antigravity', 'starting'), 'Starting Antigravity…')
  assert.equal(connectionHeading('codex', 'ready'), 'Start with Codex')
})

test('a signed-out Codex pane offers sign-in and another provider', () => {
  const html = renderToStaticMarkup(createElement(EmptyState, {
    provider: 'codex', state: 'signed-out', message: 'Sign in with your ChatGPT account.', onLogin: login, onChooseModel: noop
  }))
  assert.match(html, /Sign in to Codex/)
  assert.match(html, /Sign in with your ChatGPT account\./)
  assert.match(html, /data-ui="chat\.sign-in"/)
  assert.match(html, /Choose another model to use a different provider/)
})

test('an unavailable CLI provider keeps main’s install guidance and offers another provider only', () => {
  const html = renderToStaticMarkup(createElement(EmptyState, {
    provider: 'claude', state: 'unavailable', message: 'Install Claude Code with npm.', onLogin: login, onChooseModel: noop
  }))
  assert.match(html, /Claude Code is unavailable/)
  assert.match(html, /Install Claude Code with npm\./)
  assert.doesNotMatch(html, /data-ui="chat\.sign-in"/)
  assert.match(html, />Choose model</)
})

test('a starting pane offers neither action', () => {
  const html = renderToStaticMarkup(createElement(EmptyState, {
    provider: 'codex', state: 'starting', message: 'Starting Codex…', onLogin: login, onChooseModel: noop
  }))
  assert.match(html, /Starting Codex…/)
  assert.doesNotMatch(html, /Choose model|chat\.sign-in/)
})

test('the banner carries the same guidance above a transcript', () => {
  const html = renderToStaticMarkup(createElement(ConnectionBanner, {
    provider: 'codex', state: 'signed-out', message: 'Your session expired.', onLogin: login, onChooseModel: noop
  }))
  assert.match(html, /class="chat-connection-banner"/)
  assert.match(html, /data-state="signed-out"/)
  assert.match(html, /Sign in to Codex/)
  assert.match(html, /Your session expired\./)
  assert.match(html, /data-ui="chat\.sign-in"/)
  assert.match(html, />Choose model</)
})

test('a blocked empty pane lists which providers this machine can start', () => {
  const html = renderToStaticMarkup(createElement(EmptyState, {
    provider: 'codex', state: 'unavailable', message: 'Codex is not installed.', onLogin: login, onChooseModel: noop,
    availability: [
      { provider: 'codex', installed: false, path: null, hint: 'Install Codex.' },
      { provider: 'claude', installed: true, path: null, hint: 'Bundled.' }
    ]
  }))
  assert.match(html, /Providers on this machine/)
  assert.match(html, /aria-current="true"[^>]*>.*?Codex.*?Not installed/)
  assert.match(html, /Claude Code.*?Installed/)
  const ready = renderToStaticMarkup(createElement(EmptyState, {
    provider: 'codex', state: 'starting', message: 'Starting…', onLogin: login, onChooseModel: noop,
    availability: [{ provider: 'codex', installed: true, path: null, hint: '' }]
  }))
  assert.doesNotMatch(ready, /Providers on this machine/)
})
