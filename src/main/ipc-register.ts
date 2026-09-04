import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { IpcInvokeChannel, IpcInvokeChannels } from '../shared/ipc-channels.js'

type InvokeHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeChannels[C]['args']
) => IpcInvokeChannels[C]['result'] | Promise<IpcInvokeChannels[C]['result']>

/** Register a typed preload invoke channel on the main process. */
export function registerInvoke<C extends IpcInvokeChannel>(
  ipcMain: Pick<IpcMain, 'handle'>,
  channel: C,
  handler: InvokeHandler<C>
): void {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as IpcInvokeChannels[C]['args'])))
}
