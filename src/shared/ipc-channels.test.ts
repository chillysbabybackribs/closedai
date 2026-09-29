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
    'window:toggleFullscreen',
    'window:toggleDevTools',
    'window:desktopWallpaper',
    'wallpapers:list',
    'wallpapers:add',
    'wallpapers:read',
    'wallpapers:remove',
    'windows:context',
    'windows:list',
    'windows:detachTabs',
    'windows:returnTabs',
    'windows:revealTab',
    'windows:showBrowser',
    'windows:capture',
    'tools:setEnabledMany',
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
    'browser:resolvePermission',
    'browserDownloads:list',
    'browserDownloads:pause',
    'browserDownloads:resume',
    'browserDownloads:cancel',
    'browserDownloads:reveal',
    'browserDownloads:clear',
    'localFiles:open',
    'localFiles:openImage',
    'localFiles:image',
    'localFiles:revealImage',
    'localFiles:file',
    'localFiles:revealFile',
    'savedSites:list',
    'savedSites:save',
    'savedSites:update',
    'savedSites:remove',
    'agentRuns:list',
    'agentRuns:start',
    'agentRuns:pause',
    'agentRuns:resume',
    'agentRuns:stop',
    'agentLibrary:list',
    'agentLibrary:save',
    'agentLibrary:update',
    'agentLibrary:remove',
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
    'chat:unarchiveChat',
    'chat:setChatPinned',
    'chat:renameChat',
    'chat:retryChatTitle',
    'chat:compactConversation',
    'chat:chooseProject',
    'chat:selectProject',
    'chat:clearProject',
    'chat:selectSpace',
    'chat:providerAvailability',
    'credentials:status',
    'credentials:list',
    'credentials:save',
    'credentials:reveal',
    'credentials:remove',
    'credentials:rename',
    'credentials:setAgentAccess',
    'security:get',
    'security:set',
    'security:importCookies',
    'security:resolveCredentialApproval',
    'tools:manifest',
    'tools:telemetry',
    'tools:clearTelemetry',
    'tools:setEnabled',
    'trace:setActive',
    'trace:snapshot',
    'trace:clear',
    'models:manifest',
    'models:setEnabled',
    'models:setEnabledMany'
  ]
  assert.equal(channels.size, typed.length)
  for (const channel of typed) assert.ok(channels.has(channel), channel)
})

test('IPC event constants cover the typed event registry', () => {
  const channels = new Set(Object.values(IPC.event))
  const typed: IpcEventChannel[] = [
    'browser:state',
    'browser:tabs',
    'browser:permissionRequests',
    'browserDownloads:changed',
    'savedSites:changed',
    'chat:event',
    'agentRuns:event',
    'agentLibrary:changed',
    'security:credentialApprovals',
    'tools:event',
    'trace:event',
    'models:event',
    'windows:event'
  ]
  assert.equal(channels.size, typed.length)
  for (const channel of typed) assert.ok(channels.has(channel), channel)
})
