import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { Message } from '../preview/project-intake.js'
import { upsertProjectAssistantMessage } from './project-workspace-live.ts'

test('assistant message survives Strict Mode double invocation of state updater', () => {
  let messages: Message[] = []
  const setMessages: Dispatch<SetStateAction<Message[]>> = (action) => {
    if (typeof action !== 'function') {
      messages = action
      return
    }
    const previous = messages
    action(previous)
    messages = action(previous)
  }
  const itemIds = new Map<string, number>()
  const nextId = { current: 1 } as MutableRefObject<number>

  upsertProjectAssistantMessage({
    itemId: 'assistant-1',
    text: 'First chunk',
    appended: true,
    itemIds,
    nextId,
    setMessages
  })
  assert.deepEqual(messages.map(({ id, role, text }) => ({ id, role, text })), [
    { id: 1, role: 'coordinator', text: 'First chunk' }
  ])

  upsertProjectAssistantMessage({
    itemId: 'assistant-1',
    text: 'Complete reply',
    appended: false,
    itemIds,
    nextId,
    setMessages
  })
  assert.equal(messages[0]?.text, 'Complete reply')
  assert.equal(messages.length, 1)
})
