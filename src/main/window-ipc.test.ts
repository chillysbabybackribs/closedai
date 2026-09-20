import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerWindowIpc } from './window-ipc.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function harness(window: BrowserWindow | null) {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) }
  } as unknown as Pick<IpcMain, 'handle'>
  registerWindowIpc(ipcMain, () => window)
  return async (channel: string): Promise<void> => {
    const handler = handlers.get(channel)
    assert.ok(handler, `missing handler for ${channel}`)
    await handler({} as IpcMainInvokeEvent)
  }
}

test('fullscreen IPC toggles the current window state', async () => {
  let fullScreen = false
  const window = {
    isFullScreen: () => fullScreen,
    setFullScreen: (value: boolean) => { fullScreen = value }
  } as BrowserWindow
  const invoke = harness(window)

  await invoke('window:toggleFullscreen')
  assert.equal(fullScreen, true)
  await invoke('window:toggleFullscreen')
  assert.equal(fullScreen, false)
})

test('window IPC is a no-op after the window has gone away', async () => {
  const invoke = harness(null)
  await invoke('window:toggleFullscreen')
  await invoke('window:close')
})
