import assert from 'node:assert/strict'
import test from 'node:test'
import { actionTarget, decide } from './strategy.ts'

test('decide folds weak preflop hands facing a raise', () => {
  const decision = decide({
    heroTurn: true,
    actions: [
      { label: 'Fold', x: 1, y: 1, w: 10, h: 10 },
      { label: 'Call $1.10', x: 2, y: 1, w: 10, h: 10 }
    ],
    holeCards: ['4c', '3c'],
    board: [],
    pot: '1.85',
    stack: '50',
    handId: '1'
  })
  assert.equal(decision?.action, 'fold')
})

test('decide raises premium pairs preflop', () => {
  const decision = decide({
    heroTurn: true,
    actions: [
      { label: 'Fold', x: 1, y: 1, w: 10, h: 10 },
      { label: 'Raise $2.50', x: 2, y: 1, w: 10, h: 10 }
    ],
    holeCards: ['9c', '9d'],
    board: [],
    pot: '3',
    stack: '50',
    handId: '2'
  })
  assert.equal(decision?.action, 'raise')
})

test('actionTarget picks the matching button', () => {
  const actions = [{ label: 'Check', x: 3, y: 3, w: 8, h: 8 }]
  const snapshot = { heroTurn: true, actions, holeCards: [], board: [], pot: null, stack: null, handId: null }
  assert.equal(actionTarget(snapshot, { action: 'check', reason: 'free' })?.label, 'Check')
})
