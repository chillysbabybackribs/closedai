import assert from 'node:assert/strict'
import test from 'node:test'
import { validateInput } from './schema.js'

const schema = {
  type: 'object',
  properties: {
    url: { type: 'string', minLength: 1 },
    max_chars: { type: 'integer', minimum: 200, maximum: 1000 },
    mode: { type: 'string', enum: ['text', 'html'] },
    nested: { type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'] },
    ids: { type: 'array', items: { type: 'string' } }
  },
  required: ['url'],
  additionalProperties: false
}

test('validateInput accepts a well-formed object', () => {
  assert.deepEqual(validateInput(schema, { url: 'https://a.test', max_chars: 500, mode: 'text', nested: { flag: true }, ids: ['x'] }), [])
})

test('validateInput reports missing required, wrong types, ranges, enums, and unknown keys', () => {
  const errors = validateInput(schema, { max_chars: 5.5, mode: 'pdf', nested: {}, ids: [1], extra: 1 })
  assert.deepEqual(errors, [
    '$.url is required',
    '$.max_chars must be integer',
    '$.mode must be one of "text", "html"',
    '$.nested.flag is required',
    '$.ids[0] must be string',
    '$.extra is not a recognised argument'
  ])
  assert.deepEqual(validateInput(schema, { url: '', max_chars: 10 }), [
    '$.url must be at least 1 characters',
    '$.max_chars must be >= 200'
  ])
})

test('validateInput allows unknown keys unless additionalProperties is false', () => {
  assert.deepEqual(validateInput({ type: 'object', properties: {} }, { anything: 1 }), [])
})
