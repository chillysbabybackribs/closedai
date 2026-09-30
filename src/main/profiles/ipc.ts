import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { isProfileId } from '../../shared/local-profiles.js'
import { registerInvoke } from '../ipc-register.js'
import type { ProfileSession } from './profile-session.js'

// The gate decides what to paint on its first render, so the account list is answered
// synchronously; both calls touch one small file.
export function registerProfilesIpc(
  ipcMain: Pick<IpcMain, 'handle' | 'on'>,
  session: ProfileSession,
  relaunch: () => void
): void {
  ipcMain.on(IPC.sync.profiles.bootstrap, (event) => {
    event.returnValue = session.bootstrap()
  })
  ipcMain.on(IPC.sync.profiles.write, (event, onboarding: unknown) => {
    event.returnValue = typeof onboarding === 'string'
      ? session.write(onboarding)
      : { currentUserId: session.currentUserId() }
  })
  registerInvoke(ipcMain, IPC.invoke.profiles.switchTo, (_event, userId) => {
    if (!isProfileId(userId) || !session.prepareSwitch(userId)) return false
    relaunch()
    return true
  })
}
