import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppErrorBoundary, AppErrorPanel } from './app-error-boundary.tsx'

test('a caught render error becomes a readable message without the IPC prefix', () => {
  assert.deepEqual(
    AppErrorBoundary.getDerivedStateFromError(new Error("Error invoking remote method 'chat:snapshot': Error: hub down")),
    { message: 'hub down' }
  )
  assert.deepEqual(AppErrorBoundary.getDerivedStateFromError(''), { message: 'The window failed to render' })
})

test('the panel names the failure and offers Reload', () => {
  const html = renderToStaticMarkup(createElement(AppErrorPanel, { message: 'hub down' }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Something went wrong/)
  assert.match(html, /hub down/)
  assert.match(html, />Reload</)
})

test('children render untouched while nothing has thrown', () => {
  const html = renderToStaticMarkup(createElement(AppErrorBoundary, null, createElement('main', null, 'ready')))
  assert.equal(html, '<main>ready</main>')
})
