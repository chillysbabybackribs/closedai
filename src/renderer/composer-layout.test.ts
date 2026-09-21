import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMPOSER_LAYOUT_STORAGE_KEY,
  normalizeComposerLayout,
  persistComposerLayout,
  readComposerLayout
} from './composer-layout.ts'

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) }
  }
}

test('unknown or missing values fall back to the full composer', () => {
  assert.equal(normalizeComposerLayout(null), 'full')
  assert.equal(normalizeComposerLayout('sideways'), 'full')
  assert.equal(normalizeComposerLayout('compact'), 'compact')
  assert.equal(readComposerLayout(memoryStorage()), 'full')
})

test('a persisted compact choice is read back', () => {
  const storage = memoryStorage()
  persistComposerLayout(storage, 'compact')
  assert.equal(storage.data.get(COMPOSER_LAYOUT_STORAGE_KEY), 'compact')
  assert.equal(readComposerLayout(storage), 'compact')
  persistComposerLayout(storage, 'full')
  assert.equal(readComposerLayout(storage), 'full')
})

test('storage failures never surface', () => {
  const broken = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('full') }
  }
  assert.equal(readComposerLayout(broken), 'full')
  assert.doesNotThrow(() => persistComposerLayout(broken, 'compact'))
})
