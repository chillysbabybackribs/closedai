import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyChatZoomCommand,
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  chatZoomCommandForKey,
  clampChatZoom
} from './chat-zoom.js'

test('chat zoom steps, resets, and clamps to its supported range', () => {
  assert.equal(applyChatZoomCommand(100, 'in'), 110)
  assert.equal(applyChatZoomCommand(100, 'out'), 90)
  assert.equal(applyChatZoomCommand(180, 'reset'), CHAT_ZOOM_DEFAULT)
  assert.equal(applyChatZoomCommand(CHAT_ZOOM_MAX, 'in'), CHAT_ZOOM_MAX)
  assert.equal(applyChatZoomCommand(CHAT_ZOOM_MIN, 'out'), CHAT_ZOOM_MIN)
})

test('chat zoom normalizes arbitrary and invalid values', () => {
  assert.equal(clampChatZoom(114), 110)
  assert.equal(clampChatZoom(Number.NaN), CHAT_ZOOM_DEFAULT)
  assert.equal(clampChatZoom(Number.POSITIVE_INFINITY), CHAT_ZOOM_DEFAULT)
})

test('chat zoom keyboard commands accept Ctrl or Cmd without Alt', () => {
  const key = (value: string, modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'>> = {}) =>
    chatZoomCommandForKey({ altKey: false, ctrlKey: false, metaKey: false, key: value, ...modifiers })

  assert.equal(key('=', { ctrlKey: true }), 'in')
  assert.equal(key('+', { metaKey: true }), 'in')
  assert.equal(key('-', { ctrlKey: true }), 'out')
  assert.equal(key('0', { ctrlKey: true }), 'reset')
  assert.equal(key('=', { ctrlKey: true, altKey: true }), null)
  assert.equal(key('=', {}), null)
})
