import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../tools/registry.js'
import { applyVariantToRegistry, harnessDeveloperInstructions } from './variants.js'

test('applyVariantToRegistry patches tool descriptions', () => {
  const registry = new ToolRegistry([{
    name: 'embedded_browser',
    description: 'Browser',
    tools: [{
      name: 'page',
      description: 'Before',
      inputSchema: { type: 'object' },
      async run() { return { content: [{ type: 'text', text: 'ok' }] } }
    }]
  }])
  applyVariantToRegistry(registry, {
    id: 'test',
    overrides: { tools: { 'embedded_browser.page': { description: 'After' } } }
  })
  assert.equal(registry.namespaces[0]!.tools[0]!.description, 'After')
})

test('harnessDeveloperInstructions appends variant text', () => {
  const text = harnessDeveloperInstructions({ id: 'v', overrides: { instructions: { append: 'Harness extra.' } } })
  assert.match(text, /Harness extra\./)
})
