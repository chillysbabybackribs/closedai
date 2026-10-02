import assert from 'node:assert/strict'
import test from 'node:test'
import { readNotepadChatModel, rememberNotepadChatModel } from './notepad-chat-model.js'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

test('the notepad chat model round-trips and is absent until one is used', () => {
  const storage = memoryStorage()
  assert.equal(readNotepadChatModel(storage), null)
  rememberNotepadChatModel(storage, 'agy:gemini-3.8-flash')
  assert.equal(readNotepadChatModel(storage), 'agy:gemini-3.8-flash')
})

test('unreadable storage falls back to no remembered model', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') } }
  rememberNotepadChatModel(broken, 'claude:opus')
  assert.equal(readNotepadChatModel(broken), null)
})
