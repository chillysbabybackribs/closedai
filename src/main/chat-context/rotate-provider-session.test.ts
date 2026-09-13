import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { AppSettings } from '../../shared/types.js'
import { applyProviderRotation, planProviderRotation } from './rotate-provider-session.ts'

class MemoryRotationSettings {
  saved: AppSettings = { ...DEFAULT_APP_SETTINGS, chatSessionRotations: [] }
  released = false
  get(): AppSettings { return structuredClone(this.saved) }
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.saved = { ...this.saved, ...patch }
    return this.get()
  }
  checkpoint() { return null }
  sessionRotations() { return this.saved.chatSessionRotations ?? [] }
}

const user = (id: string, text: string): ChatTranscriptItem => ({ type: 'user', id, turnId: 't-1', text })
const assistant = (id: string, text: string): ChatTranscriptItem => ({
  type: 'assistant', id, turnId: 't-1', text, streaming: false, phase: 'final_answer'
})

test('planProviderRotation builds continuation metadata and increments epoch', () => {
  const items = [user('u-1', 'Start'), assistant('a-1', 'Done')]
  const planned = planProviderRotation({
    paneId: 'pane-a',
    provider: 'codex',
    threadId: 'thread-a',
    threadName: 'Demo',
    items,
    checkpoint: null,
    existingContinuation: null,
    existingRotations: [{ epoch: 1, sourceThroughItemId: 'a-0', providerThreadId: 'old', at: 1 }]
  })
  assert.ok(planned)
  assert.equal(planned.rotation.epoch, 2)
  assert.equal(planned.continuation.sourceThreadId, 'thread-a')
  assert.equal(planned.continuation.sourceThroughItemId, 'a-1')
  assert.match(planned.continuation.handoff ?? '', /rotated to reduce context/i)
})

test('applyProviderRotation persists continuation and rotation without clearing transcript items', async () => {
  const settings = new MemoryRotationSettings()
  const items = [user('u-1', 'Hello')]
  const rotated = await applyProviderRotation(settings, {
    paneId: 'pane-a',
    provider: 'claude',
    threadId: 'claude:abc',
    threadName: 'Hello',
    items
  }, async () => { settings.released = true }, { usedTokens: 180_000, contextWindow: 200_000 })
  assert.equal(rotated, true)
  assert.equal(settings.released, true)
  assert.equal(settings.saved.chatContinuation?.sourceThreadId, 'claude:abc')
  assert.equal(settings.saved.chatSessionRotations?.length, 1)
})

test('applyProviderRotation returns false when there is nothing to rotate', async () => {
  const settings = new MemoryRotationSettings()
  const rotated = await applyProviderRotation(settings, {
    paneId: 'pane-a',
    provider: 'codex',
    threadId: null,
    threadName: null,
    items: []
  }, async () => { settings.released = true }, null)
  assert.equal(rotated, false)
  assert.equal(settings.released, false)
})
