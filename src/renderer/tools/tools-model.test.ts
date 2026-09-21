import assert from 'node:assert/strict'
import test from 'node:test'

import type { ToolInfo, ToolManifest } from '../../shared/tools.ts'
import { detectPreset, formatTokens, groupSwitches, groupTools, presetSwitches, toolSwitches } from './tools-model.ts'

function tool(id: string, group: ToolInfo['group'], enabled = true, actions: string[] = [], costTokens = 100): ToolInfo {
  const [namespace, name] = id.split('.') as [string, string]
  return {
    id, namespace, name, description: 'model text', label: name, summary: '', offEffect: '', group, costTokens,
    deferLoading: false, enabled, timeoutMs: null, fields: [], inputSchema: {},
    actions: actions.map((action) => ({ id: `${id}.${action}`, name: action, description: '', fields: [], enabled }))
  }
}

const manifest = (tools: ToolInfo[]): ToolManifest => ({
  providers: [],
  namespaces: [{ name: 'all', description: '', tools }],
  groups: [
    { id: 'reads-web', label: 'Read the web', effect: 'Reads only', summary: '' },
    { id: 'acts-in-browser', label: 'Act in the browser', effect: 'Acts as you', summary: '' },
    { id: 'runs-native', label: 'This machine', effect: 'Runs native code', summary: '' }
  ],
  advertisedTokens: 0,
  readOnlyIds: ['embedded_browser.page', 'search.query']
})

test('groups follow manifest order, drop empty groups, and report mixed state and cost', () => {
  const groups = groupTools(manifest([
    tool('embedded_browser.page', 'reads-web', true, ['navigate', 'read_page'], 300),
    tool('search.query', 'reads-web', false, [], 200),
    tool('embedded_browser.script', 'acts-in-browser', true, [], 150)
  ]), { stats: [], totalCalls: 0 })
  assert.deepEqual(groups.map((group) => group.group.id), ['reads-web', 'acts-in-browser'])
  assert.equal(groups[0]!.state, 'mixed')
  assert.equal(groups[0]!.costTokens, 300)
  assert.equal(groups[1]!.state, 'on')
})

test('rows flag genuine errors red and misuse amber, wording refused calls for an off tool', () => {
  const groups = groupTools(manifest([
    tool('embedded_browser.page', 'reads-web'),
    tool('search.query', 'reads-web', false),
    tool('embedded_browser.script', 'acts-in-browser')
  ]), { totalCalls: 9, stats: [
    { toolId: 'embedded_browser.page', action: null, calls: 5, failures: 3, timeouts: 0, misuses: 1 },
    { toolId: 'search.query', action: null, calls: 2, failures: 2, timeouts: 0, misuses: 2 }
  ] })
  const [page, query] = groups[0]!.rows
  assert.deepEqual([page!.flag, page!.note], ['bad', '2 errors'])
  assert.deepEqual([query!.flag, query!.note], ['warn', '2 refused calls'])
  assert.deepEqual([groups[1]!.rows[0]!.flag, groups[1]!.rows[0]!.note], [null, ''])
})

test('a row switch covers every verb of an action tool; a group switch flips all its rows', () => {
  const page = tool('embedded_browser.page', 'reads-web', true, ['navigate', 'read_page'])
  assert.deepEqual(toolSwitches(page, false), [
    { id: 'embedded_browser.page.navigate', enabled: false }, { id: 'embedded_browser.page.read_page', enabled: false }
  ])
  const groups = groupTools(manifest([page, tool('search.query', 'reads-web', false)]), null)
  assert.deepEqual(groupSwitches(groups[0]!).map((s) => s.enabled), [false, false, false])
})

test('presets are detected from the switches and reproduced as switches', () => {
  const all = manifest([tool('embedded_browser.page', 'reads-web'), tool('search.query', 'reads-web'), tool('native_instrument.probe', 'runs-native')])
  assert.equal(detectPreset(all), 'full')
  const readOnly = presetSwitches(all, 'read-only')
  assert.deepEqual(readOnly, [
    { id: 'embedded_browser.page', enabled: true }, { id: 'search.query', enabled: true }, { id: 'native_instrument.probe', enabled: false }
  ])
  const applied = manifest([tool('embedded_browser.page', 'reads-web'), tool('search.query', 'reads-web'), tool('native_instrument.probe', 'runs-native', false)])
  assert.equal(detectPreset(applied), 'read-only')
  const custom = manifest([tool('embedded_browser.page', 'reads-web', false), tool('search.query', 'reads-web'), tool('native_instrument.probe', 'runs-native')])
  assert.equal(detectPreset(custom), 'custom')
})

test('token counts read as people write them', () => {
  assert.equal(formatTokens(820), '820')
  assert.equal(formatTokens(4120), '4.1k')
  assert.equal(formatTokens(12800), '13k')
})
