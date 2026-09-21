import type { BrowserWindow } from 'electron'

// Renderer loss for the app shell. Browser tabs already treat `render-process-gone` as the
// authoritative liveness signal (browser-tab.ts); the shell's own renderer had no handler, so an
// OOM or crash in the UI left a blank frameless window with no way back. Policy: a first loss is
// reloaded silently; a second within a minute is reported instead of reloaded, because a reload
// that crashes straight away is a defect the user must know about, not a loop to hide.

export const RENDERER_RELOAD_WINDOW_MS = 60_000

export type RendererLossAction = 'ignore' | 'reload' | 'report'

export type RendererGone = { reason: string; exitCode?: number }

export function rendererLossAction(reason: string, lastReloadAt: number | null, now: number): RendererLossAction {
  if (reason === 'clean-exit') return 'ignore'
  if (lastReloadAt !== null && now - lastReloadAt < RENDERER_RELOAD_WINDOW_MS) return 'report'
  return 'reload'
}

export function rendererLossErrorBox(details: RendererGone): { title: string; content: string } {
  const exit = typeof details.exitCode === 'number' ? ` (exit code ${details.exitCode})` : ''
  return {
    title: 'ClosedAI window crashed',
    content: `The app window's renderer stopped twice within a minute: ${details.reason}${exit}.\n\n`
      + 'Restart ClosedAI. If this keeps happening, start it from a terminal to read the full log.'
  }
}

export type RecoveryWindow = Pick<BrowserWindow, 'isDestroyed' | 'reload' | 'webContents'>

export type RendererRecoveryOptions = {
  showErrorBox: (title: string, content: string) => void
  now?: () => number
  log?: Pick<Console, 'error' | 'warn'>
}

export function installRendererRecovery(window: RecoveryWindow, options: RendererRecoveryOptions): void {
  const log = options.log ?? console
  const now = options.now ?? Date.now
  let lastReloadAt: number | null = null
  window.webContents.on('render-process-gone', (_event, details) => {
    const action = rendererLossAction(details.reason, lastReloadAt, now())
    if (action === 'ignore') return
    log.error(`[main] app window renderer gone: ${details.reason}${typeof details.exitCode === 'number' ? ` (exit code ${details.exitCode})` : ''}; ${action === 'reload' ? 'reloading' : 'reporting'}`)
    if (action === 'reload') {
      lastReloadAt = now()
      if (!window.isDestroyed()) window.reload()
      return
    }
    const box = rendererLossErrorBox(details)
    options.showErrorBox(box.title, box.content)
  })
  window.webContents.on('unresponsive', () => {
    log.warn('[main] app window renderer is unresponsive')
  })
  window.webContents.on('responsive', () => {
    log.warn('[main] app window renderer is responsive again')
  })
}
