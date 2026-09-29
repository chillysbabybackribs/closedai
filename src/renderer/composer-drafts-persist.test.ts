import assert from 'node:assert/strict'
import test from 'node:test'

test('unsent drafts are saved to localStorage and read back by the next launch', async () => {
  const values = new Map<string, string>()
  const pagehide: Array<() => void> = []
  Object.assign(globalThis, {
    window: {
      localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } },
      addEventListener: (type: string, listener: () => void) => { if (type === 'pagehide') pagehide.push(listener) }
    }
  })
  values.set('closedai.composer.drafts.v1', JSON.stringify({ 'pane-old': { input: 'from last launch', attachments: [] } }))
  const drafts = await import('./composer-drafts.ts')
  assert.equal(drafts.getComposerDraft('pane-old').input, 'from last launch')

  const pasted = { id: 'img', name: 'paste.png', kind: 'image' as const, source: { type: 'url' as const, url: `data:image/png;base64,${'A'.repeat(70_000)}` } }
  drafts.setComposerDraft('pane-new', { input: 'half-written', attachments: [pasted] })
  for (const listener of pagehide) listener()
  const saved = JSON.parse(values.get('closedai.composer.drafts.v1')!) as Record<string, { input: string; attachments: unknown[] }>
  assert.equal(saved['pane-new']?.input, 'half-written')
  assert.deepEqual(saved['pane-new']?.attachments, [], 'a pasted image too large for storage stays in memory only')
  assert.equal(saved['pane-old']?.input, 'from last launch')
})
