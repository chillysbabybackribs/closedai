import { screen, type BrowserWindow } from 'electron'
import { createAppWindow, loadAppRenderer, type MainWindowActions } from '../main-window.js'

const WIDTH = 960
const HEIGHT = 820

/**
 * A window for chats moved out of the main one. A reopened window gets the bounds, monitor and
 * maximized state Electron saved under its name (falling back to a connected display when that
 * monitor is gone); a new one opens under the pointer, on whichever display the pointer is.
 */
export function openDetachedWindow(id: string, actions: MainWindowActions, activate = true): BrowserWindow {
  const cursor = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(cursor).workArea
  const width = Math.min(WIDTH, area.width)
  const height = Math.min(HEIGHT, area.height)
  const x = Math.round(Math.min(Math.max(cursor.x - width / 2, area.x), area.x + area.width - width))
  const y = Math.round(Math.min(Math.max(cursor.y - 24, area.y), area.y + area.height - height))
  const window = createAppWindow(actions, { name: `detached-${id}`, width, height, minWidth: 480, minHeight: 420, x, y, activate })
  loadAppRenderer(window, id)
  return window
}
