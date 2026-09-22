import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectPeerChatId } from '../project-peers/project-peer-ids.ts'
import { mergeProjectRoleContext, projectRoleAdditionalContext } from './project-turn-context.ts'

test('project role context attaches only for project peer pane ids', () => {
  const intakeId = projectPeerChatId('/p', 'intake')
  assert.ok(projectRoleAdditionalContext(intakeId)?.['closedai.project.intake'])
  assert.equal(projectRoleAdditionalContext('preview-chat-1'), undefined)
  const merged = mergeProjectRoleContext(intakeId, undefined)
  assert.equal(merged?.['closedai.project.intake']?.kind, 'application')
})
