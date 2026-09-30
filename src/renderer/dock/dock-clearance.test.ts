import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dockClearance } from './dock-clearance.js'
import { DOCK_RESERVE, REVEAL_EDGE } from './dock-model.js'

describe('dockClearance', () => {
  it('discounts the workspace edge padding from the dock reserve', () => {
    assert.equal(dockClearance(DOCK_RESERVE), DOCK_RESERVE - REVEAL_EDGE)
  })
})
