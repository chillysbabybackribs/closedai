import assert from 'node:assert/strict'
import test from 'node:test'
import { chatRecord } from './chat-peers/peer-manager-harness.js'
import { ChatStore } from './chat-store/chat-store.js'
import { DEFAULT_APP_SETTINGS } from './app-settings-store.js'
import { migrateRetiredHostCheckoutPaths } from './project-path-migration.js'

const LIVE = '/home/dp/Documents/closedai'

test('migrateRetiredHostCheckoutPaths rewrites settings, workspace history, and chat records', () => {
  const store = ChatStore.inMemory([
    chatRecord('a', 'gpt', { cwd: '/home/dp/Desktop/close/closedai', projectPath: '/home/dp/Desktop/close/closedai' }),
    chatRecord('b', 'gpt', { cwd: '/other/project', projectPath: '/other/project' })
  ])
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    chatWorkspacePath: '/home/dp/Desktop/closedai',
    chatProjectPath: '/home/dp/Desktop/closedai',
    chatWorkspaces: [{
      cwd: '/home/dp/Desktop/close/closedai',
      projectPath: '/home/dp/Desktop/close/closedai',
      openIds: [],
      peers: [],
      selectedPaneId: null
    }]
  }
  const migrated = migrateRetiredHostCheckoutPaths(LIVE, settings, store)
  assert.equal(migrated.chatWorkspacePath, LIVE)
  assert.equal(migrated.chatProjectPath, LIVE)
  assert.equal(migrated.chatWorkspaces[0]?.cwd, LIVE)
  assert.equal(migrated.chatWorkspaces[0]?.projectPath, LIVE)
  assert.equal(store.require('a').cwd, LIVE)
  assert.equal(store.require('b').cwd, '/other/project')
})
