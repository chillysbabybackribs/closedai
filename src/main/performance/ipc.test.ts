import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppSettingsStore } from '../app-settings-store.js'
import { ResponseLatency } from '../trace/response-latency.js'
import { registerPerformanceIpc } from './ipc.js'
import type { PerformanceSettings } from '../../shared/performance.js'

test('updates only the narrow performance contract and broadcasts persisted settings', async () => {
  const store = await AppSettingsStore.open(join(await mkdtemp(join(tmpdir(), 'performance-ipc-')), 'settings.json'))
  await store.set({ chatCursorBaselineEnabled: true })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>()
  const ipc = { handle: (channel: string, handler: (event: IpcMainInvokeEvent, value?: unknown) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain
  const changed: PerformanceSettings[] = []
  registerPerformanceIpc(ipc, { settings: () => store, responses: new ResponseLatency(() => {}), changed: (value) => changed.push(value) })
  const invoke = async (channel: string, value?: unknown) => handlers.get(`performance:${channel}`)!({} as IpcMainInvokeEvent, value)
  for (const patch of [null, [], { chatCursorBaselineEnabled: false }, { instantStreaming: 'yes' }, { warmMinutes: Infinity }]) {
    await assert.rejects(invoke('update', patch), /Invalid|Unknown/)
  }
  assert.deepEqual(await invoke('update', { warmMinutes: 999, autoTitles: false }), {
    instantStreaming: false, warmMinutes: 60, warmIdleChats: 2, autoTitles: false
  })
  assert.deepEqual(await invoke('settings'), changed[0])
  assert.equal(store.get().chatCursorBaselineEnabled, true)
  assert.equal(changed.length, 1)
  assert.deepEqual(await invoke('summary'), { capacity: 200, samples: 0, groups: [] })
  await invoke('paint', { paneId: 1, turnId: null, rendererMs: 'bad' })
})
