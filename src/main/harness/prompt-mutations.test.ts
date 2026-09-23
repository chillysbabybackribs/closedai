import assert from 'node:assert/strict'
import test from 'node:test'
import { generatePromptMutations } from './prompt-mutations.js'
import { harnessDeveloperInstructions } from './variants.js'

test('generatePromptMutations returns unique ids and includes baseline', () => {
  const variants = generatePromptMutations(100)
  assert.equal(variants.length, 100)
  assert.equal(variants[0]!.id, 'sweep-000')
  assert.deepEqual(variants[0]!.overrides, undefined)
  const ids = new Set(variants.map((v) => v.id))
  assert.equal(ids.size, 100)
})

test('instruction mutations change assembled developer text', () => {
  const main = harnessDeveloperInstructions()
  const mutated = harnessDeveloperInstructions(generatePromptMutations(100)[1])
  assert.notEqual(main, mutated)
})
