import assert from 'node:assert/strict'
import test from 'node:test'
import { activateTabSurface, type ActivatableTabSurface } from './browser-tab-activation.js'

const bounds = { x: 10, y: 20, width: 800, height: 600 }

test('a returning tab receives its visible surface before Electron attaches it', () => {
  const calls: string[] = []
  const tab = (id: string): ActivatableTabSurface => ({
    id,
    hide: () => calls.push(`hide:${id}`),
    applyBounds: (_bounds, show) => calls.push(`surface:${id}:${show}`)
  })
  const previous = tab('previous')
  const next = tab('next')

  activateTabSurface(
    [previous, next], next, bounds, { paneVisible: true, pageVisible: true },
    () => calls.push('attach'),
    () => calls.push('raise')
  )

  assert.deepEqual(calls, ['hide:previous', 'surface:next:true', 'attach', 'raise'])
})

test('activation while the browser pane is hidden does not expose or raise a view', () => {
  const calls: string[] = []
  const next: ActivatableTabSurface = {
    id: 'next',
    hide: () => calls.push('hide'),
    applyBounds: () => calls.push('surface')
  }
  activateTabSurface(
    [next], next, bounds, { paneVisible: false, pageVisible: false },
    () => calls.push('activate'),
    () => calls.push('raise')
  )
  assert.deepEqual(calls, ['activate'])
})
