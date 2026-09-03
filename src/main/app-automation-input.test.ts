import assert from 'node:assert/strict'
import test from 'node:test'
import type { MouseInputEvent } from 'electron'

import { dispatchAppClick } from './app-automation-input.js'

test('app clicks focus the Electron surface and dispatch one complete native click', () => {
  const calls: string[] = []
  const events: MouseInputEvent[] = []
  dispatchAppClick(
    { focus: () => { calls.push('window.focus') } },
    {
      focus: () => { calls.push('contents.focus') },
      sendInputEvent: (event) => { events.push(event as MouseInputEvent) }
    },
    { x: 120.5, y: 48 }
  )

  assert.deepEqual(calls, ['window.focus', 'contents.focus'])
  assert.deepEqual(events, [
    { type: 'mouseMove', x: 120.5, y: 48 },
    { type: 'mouseDown', x: 120.5, y: 48, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: 120.5, y: 48, button: 'left', clickCount: 1 }
  ])
})
