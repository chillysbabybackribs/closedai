import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { browserDockInset, dockClearance } from './dock-clearance.js'
import { DOCK_RESERVE, REVEAL_EDGE } from './dock-model.js'

describe('browserDockInset', () => {
  it('leaves a browser window alone while the dock is not pinned', () => {
    assert.equal(browserDockInset({ y: 0, height: 900 }, 900, 0), 0)
  })

  it('insets a window that reaches the floor by the clearance', () => {
    assert.equal(browserDockInset({ y: 0, height: 900 }, 900, 59), 59)
  })

  it('insets only the part inside the band, and nothing for a window above it', () => {
    assert.equal(browserDockInset({ y: 100, height: 700 }, 900, 59), 0)
    assert.equal(browserDockInset({ y: 100, height: 800 }, 900, 59), 59)
    assert.equal(browserDockInset({ y: 100, height: 780 }, 900, 59), 39)
  })

  it('never insets past the window itself', () => {
    assert.equal(browserDockInset({ y: 850, height: 40 }, 900, 59), 40)
  })
})

describe('dockClearance', () => {
  it('discounts the workspace edge padding from the dock reserve', () => {
    assert.equal(dockClearance(DOCK_RESERVE), DOCK_RESERVE - REVEAL_EDGE)
  })
})
