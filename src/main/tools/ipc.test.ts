import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.ts'
import { IPC } from '../../shared/ipc-channels.ts'
import type { ToolsEvent } from '../../shared/tools.ts'
import { ToolRegistry } from './registry.ts'
import { registerToolsIpc } from './ipc.ts'

test('Cursor baseline IPC persists, notifies other windows and rejects non-boolean input', async () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  let saved = { ...DEFAULT_APP_SETTINGS }
  const events: ToolsEvent[] = []
  registerToolsIpc({ handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain, {
    registry: () => new ToolRegistry([]), telemetry: () => null, providers: () => ['codex', 'claude', 'antigravity'],
    settings: () => ({ get: () => saved, set: async (patch) => { saved = { ...saved, ...patch }; return saved } }),
    notifyEvent: (event) => events.push(event), onEnabledChanged: async () => {}, onEnabledManyChanged: async () => {}
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  assert.equal((invoke(IPC.invoke.tools.manifest) as { chatCursorBaselineEnabled: boolean }).chatCursorBaselineEnabled, false)
  await invoke(IPC.invoke.tools.setChatCursorBaselineEnabled, true)
  assert.equal((invoke(IPC.invoke.tools.manifest) as { chatCursorBaselineEnabled: boolean }).chatCursorBaselineEnabled, true)
  assert.equal(saved.chatSeamlessRotation, true)
  assert.equal(saved.chatToolSliceEnabled, true)
  assert.equal(saved.chatWorkspaceLedgerEnabled, true)
  assert.deepEqual(events, [{ type: 'changed' }])
  await assert.rejects(async () => invoke(IPC.invoke.tools.setChatCursorBaselineEnabled, 'true'), /Invalid Cursor baseline toggle/)
  assert.equal(events.length, 1)
  await invoke(IPC.invoke.tools.setChatCursorBaselineEnabled, false)
  assert.equal(saved.chatCursorBaselineEnabled, false)
})
