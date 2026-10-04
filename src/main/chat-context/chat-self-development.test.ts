import assert from 'node:assert/strict'
import test from 'node:test'
import { setAppCheckoutPath } from '../app-checkout.ts'
import { chatSelfDevelopment, toolSliceTurnInput } from './chat-self-development.ts'

test('chatSelfDevelopment is true only for the host checkout path', () => {
  setAppCheckoutPath('/home/dp/Documents/closedai')
  assert.equal(chatSelfDevelopment('/home/dp/Documents/closedai'), true)
  assert.equal(chatSelfDevelopment('/other/project'), false)
})

test('toolSliceTurnInput carries selfDevelopment from cwd', () => {
  setAppCheckoutPath('/app')
  const turn = toolSliceTurnInput('fix tests', null, '/app')
  assert.equal(turn.selfDevelopment, true)
})
