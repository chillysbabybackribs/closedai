import type { WebContents } from 'electron'
import { decideWindowOpen, type CreatePopupTab } from './browser-popup-policy.js'

export function installPopupBridge(
  contents: WebContents,
  partition: string,
  createPopupTab?: CreatePopupTab
): void {
  contents.setWindowOpenHandler((details) => decideWindowOpen(details, partition, createPopupTab))
}
