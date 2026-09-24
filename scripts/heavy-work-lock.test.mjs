import assert from 'node:assert/strict'
import test from 'node:test'
import { isHeavyWorkspaceCommand } from './heavy-work-lock.mjs'

test('npm build and test invocations are heavy', () => {
  assert.equal(isHeavyWorkspaceCommand(['npm', 'run', 'build']), true)
  assert.equal(isHeavyWorkspaceCommand(['npm', 'test']), true)
  assert.equal(isHeavyWorkspaceCommand(['npm', 'run', 'typecheck']), false)
})

test('live verify scripts and work-lock itself', () => {
  assert.equal(isHeavyWorkspaceCommand(['node', 'scripts/browser-live-check.mjs']), true)
  assert.equal(isHeavyWorkspaceCommand(['node', 'scripts/work-lock.mjs', '--', 'npm', 'test']), false)
})
