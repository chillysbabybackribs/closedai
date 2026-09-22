import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseProjectPeerRole } from '../../shared/project-peer-ids.ts'
import { projectPeerChatId } from './project-peer-ids.ts'

test('project peer ids are stable and parseable', () => {
  const intake = projectPeerChatId('/tmp/demo', 'intake')
  const coordinator = projectPeerChatId('/tmp/demo', 'coordinator')
  assert.notEqual(intake, coordinator)
  assert.equal(parseProjectPeerRole(intake), 'intake')
  assert.equal(parseProjectPeerRole(coordinator), 'coordinator')
  assert.equal(projectPeerChatId('/tmp/demo', 'intake'), intake)
})
