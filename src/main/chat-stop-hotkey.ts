import type { App, Input, WebContents } from 'electron'

type ActiveTurn = {
  isTurnActive: () => boolean
  interrupt: () => Promise<void>
}

type StopHotkeyInput = Pick<Input, 'type' | 'key' | 'isAutoRepeat' | 'isComposing'>

export function isStopHotkey(input: StopHotkeyInput): boolean {
  return input.type === 'keyDown' &&
    input.key === 'Escape' &&
    !input.isAutoRepeat &&
    !input.isComposing
}

/**
 * Listen at the WebContents layer so Escape still works while an embedded browser
 * page, rather than the application renderer, owns keyboard focus.
 */
export function installChatStopHotkey(app: App, activeTurn: () => ActiveTurn | null): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('before-input-event', (event, input) => {
      const turn = activeTurn()
      if (!turn?.isTurnActive() || !isStopHotkey(input)) return

      event.preventDefault()
      void turn.interrupt().catch(() => {
        // ChatService reports the failure in the transcript.
      })
    })
  })
}
