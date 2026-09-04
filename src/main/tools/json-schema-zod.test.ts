import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { appTools } from '../tools/app/index.js'
import { batchTools } from '../tools/batch/index.js'
import { browserTools } from '../tools/browser/index.js'
import { captureTools } from '../tools/capture/index.js'
import { cdpTools } from '../tools/cdp/index.js'
import { createToolRegistry } from '../tools/index.js'
import { credentialVaultTools } from './credential-vault/index.js'
import { searchTools } from '../tools/search/index.js'
import { WORKSPACE_INDEX_ROOT } from '../tools/workspace/workspace-index.generated.js'
import { workspaceTools } from '../tools/workspace/index.js'
import { zodShapeFromJsonSchema } from './json-schema-zod.js'

test('a typical action-tool schema imports exactly with descriptions, enums, and bounds', () => {
  const { shape, exact } = zodShapeFromJsonSchema({
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'read_page'], description: 'The verb.' },
      url: { type: 'string', minLength: 1, description: 'Absolute URL.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' },
      tab_id: { type: ['string', 'null'], description: 'Tab.' }
    },
    required: ['action'],
    additionalProperties: false
  })
  assert.equal(exact, true)
  assert.deepEqual(Object.keys(shape), ['action', 'url', 'limit', 'tab_id'])
  const json = z.toJSONSchema(z.object(shape)) as { properties: Record<string, Record<string, unknown>>; required?: string[] }
  assert.equal(json.properties.action!.description, 'The verb.')
  assert.deepEqual(json.properties.action!.enum, ['navigate', 'read_page'])
  assert.equal(json.properties.limit!.maximum, 50)
  assert.equal(json.properties.url!.description, 'Absolute URL.')
  assert.deepEqual(json.required, ['action'])
  assert.equal(z.object(shape).safeParse({ action: 'navigate', limit: 99 }).success, false)
  assert.equal(z.object(shape).safeParse({ action: 'navigate', tab_id: null }).success, true)
})

test('an unimportable schema degrades to loose typed fields instead of dropping the tool', () => {
  const { shape, exact } = zodShapeFromJsonSchema({
    type: 'object',
    properties: { data: { $ref: '#/$defs/missing', description: 'Payload.' }, name: { type: 'string' } },
    required: ['name']
  })
  assert.equal(exact, false)
  assert.deepEqual(Object.keys(shape), ['data', 'name'])
  assert.equal(z.object(shape).safeParse({ name: 'x' }).success, true)
  assert.equal(z.object(shape).safeParse({}).success, false)
})

test('every registered ClosedAI tool schema imports exactly', () => {
  const stub = (): never => { throw new Error('not called during schema conversion') }
  const registry = createToolRegistry([])
  const namespaces = [
    appTools(stub as never, stub as never),
    browserTools(stub as never),
    cdpTools(stub as never),
    captureTools(stub as never),
    credentialVaultTools(stub as never),
    searchTools(),
    workspaceTools(WORKSPACE_INDEX_ROOT)!,
    batchTools(() => registry, { maxCalls: 16 })
  ]
  const inexact: string[] = []
  for (const namespace of namespaces) {
    for (const tool of namespace.tools) {
      const { shape, exact } = zodShapeFromJsonSchema(tool.inputSchema)
      if (!exact) inexact.push(`${namespace.name}.${tool.name}`)
      assert.ok(Object.keys(shape).length > 0, `${namespace.name}.${tool.name} has fields`)
      z.toJSONSchema(z.object(shape))
    }
  }
  assert.deepEqual(inexact, [])
})
