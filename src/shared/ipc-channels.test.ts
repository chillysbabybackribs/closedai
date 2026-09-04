import assert from 'node:assert/strict'
import test from 'node:test'

import { IPC, type IpcEventChannel, type IpcInvokeChannel } from './ipc-channels.js'

function leafValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(leafValues)
  }
  return []
}

test('IPC invoke constants cover the typed invoke registry', () => {
  const channels = new Set(leafValues(IPC.invoke))
  const typed: IpcInvokeChannel[] = [
    'window:minimize',
    'window:maximize',
    'window:close',
    'browser:setBounds',
    'browser:navigate',
    'browser:back',
    'browser:forward',
    'browser:reload',
    'browser:searchHistory',
    'browser:removeHistory',
    'browser:suggest',
    'browser:snapshot',
    'browser:newTab',
    'browser:newTabToRight',
    'browser:openTab',
    'browser:closeTab',
    'browser:closeOtherTabs',
    'browser:closeTabsToRight',
    'browser:duplicateTab',
    'browser:reloadTab',
    'browser:renameTab',
    'browser:selectTab',
    'browser:capture',
    'browserDownloads:list',
    'browserDownloads:pause',
    'browserDownloads:resume',
    'browserDownloads:cancel',
    'browserDownloads:reveal',
    'browserDownloads:clear',
    'chat:snapshot',
    'chat:historyPage',
    'chat:send',
    'chat:interrupt',
    'chat:selectPane',
    'chat:setVisiblePanes',
    'chat:selectModel',
    'chat:selectReasoningEffort',
    'chat:refreshPlanUsage',
    'chat:login',
    'chat:listChats',
    'chat:newPeer',
    'chat:closePeer',
    'chat:continueInNewPeer',
    'chat:openChat',
    'chat:archiveChat',
    'chat:setChatPinned',
    'chat:compactConversation',
    'chat:chooseProject',
    'chat:selectProject',
    'chat:clearProject',
    'tools:manifest',
    'tools:telemetry',
    'tools:clearTelemetry',
    'tools:setEnabled',
    'trace:setActive',
    'trace:snapshot',
    'trace:clear'
  ]
  assert.equal(channels.size, typed.length)
  for (const channel of typed) assert.ok(channels.has(channel), channel)
})

test('IPC event constants cover the typed event registry', () => {
  const channels = new Set(Object.values(IPC.event))
  const typed: IpcEventChannel[] = [
    'browser:state',
    'browser:tabs',
    'browserDownloads:changed',
    'chat:event',
    'tools:event',
    'trace:event'
  ]
  assert.equal(channels.size, typed.length)
  for (const channel of typed) assert.ok(channels.has(channel), channel)
})
