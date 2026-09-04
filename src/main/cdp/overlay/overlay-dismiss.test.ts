import assert from 'node:assert/strict'
import test from 'node:test'
import { runOverlayDismissal, type BrowserDismissAdapter } from './overlay-dismiss.ts'

test('runOverlayDismissal reports not_found when nothing is open', async () => {
  const adapter: BrowserDismissAdapter = {
    inspect: async () => null,
    consentAccept: async () => false,
    sendEscape: async () => {},
    semanticClose: async () => false,
    pointerClose: async () => false,
    waitForDismissal: async () => true,
    cleanup: async () => {}
  }
  const result = await runOverlayDismissal(adapter)
  assert.equal(result.status, 'not_found')
})

test('runOverlayDismissal stops after the first successful strategy', async () => {
  const adapter: BrowserDismissAdapter = {
    inspect: async () => ({ token: 't1', kind: 'modal', name: 'Sign in' }),
    consentAccept: async () => false,
    sendEscape: async () => {},
    semanticClose: async () => true,
    pointerClose: async () => false,
    waitForDismissal: async () => true,
    cleanup: async () => {}
  }
  const result = await runOverlayDismissal(adapter)
  assert.equal(result.status, 'dismissed')
  assert.equal(result.strategy, 'semantic-close')
})
