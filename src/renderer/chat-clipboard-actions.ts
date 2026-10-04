import { injectComposerDraft } from './composer-drafts.js'

export function selectedText(): string {
  return window.getSelection()?.toString() ?? ''
}

export async function copySelectedText(): Promise<boolean> {
  const text = selectedText()
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function focusComposerInput(paneId: string): void {
  const pane = document.querySelector(`aside.prompt-chat[data-pane-id="${CSS.escape(paneId)}"]`)
  const input = pane?.querySelector('[data-ui="composer.input"]') as HTMLTextAreaElement | null
  input?.focus()
}

/** After layout or selection changes, wait for the target pane to paint before focusing its composer. */
export function scheduleComposerFocus(paneId: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => focusComposerInput(paneId))
  })
}

export async function pasteTextToComposer(paneId: string): Promise<boolean> {
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    return false
  }
  if (!text) return false
  injectComposerDraft(paneId, text)
  focusComposerInput(paneId)
  return true
}
