import assert from 'node:assert/strict'
import test from 'node:test'

import { READ_ONLY_TOOL_IDS, TOOL_CATALOG, TOOL_GROUPS, catalogEntry, deferredStubTokens, estimateToolTokens } from './catalog.ts'

test('every catalog entry is complete and belongs to a declared group', () => {
  const groups = new Set(TOOL_GROUPS.map((group) => group.id))
  for (const [id, entry] of Object.entries(TOOL_CATALOG)) {
    assert.match(id, /^[a-z_]+\.[a-z_]+$/, id)
    assert.ok(entry.label.length > 0 && entry.summary.length > 0 && entry.offEffect.length > 0, id)
    assert.ok(groups.has(entry.group), `${id} group ${entry.group}`)
  }
})

test('read-only ids are catalogued and never in an acting group', () => {
  for (const id of READ_ONLY_TOOL_IDS) {
    const entry = TOOL_CATALOG[id]
    assert.ok(entry, id)
    assert.notEqual(entry.group, 'acts-in-browser', id)
    assert.notEqual(entry.group, 'reads-secrets', id)
    assert.notEqual(entry.group, 'runs-native', id)
  }
  assert.ok(!READ_ONLY_TOOL_IDS.includes('closedai_app.command'))
})

test('an uncatalogued tool still gets a readable name and the generic off effect', () => {
  const entry = catalogEntry('some_namespace.do_the_thing')
  assert.equal(entry.label, 'Do the thing')
  assert.equal(entry.group, 'controls-app')
  assert.match(entry.offEffect, /refused/)
})

test('token estimate follows the advertised text and deferred stubs stay small', () => {
  const tool = { name: 'page', description: 'x'.repeat(400), inputSchema: { type: 'object', properties: {} }, run: async () => ({ content: [] }) }
  const full = estimateToolTokens('embedded_browser', tool)
  assert.ok(full > 100 && full < 140, String(full))
  assert.ok(deferredStubTokens('embedded_browser', tool) < 12)
})
