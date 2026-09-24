import { createHash } from 'node:crypto'

import type { CapturedImage } from './host.js'
import type { ScreenshotSurface } from './screenshot-store.js'

/** SHA-1 of the model JPEG payload — cheap identity for back-to-back identical frames. */
export function captureFingerprint(image: CapturedImage): string {
  return createHash('sha1').update(image.model.dataUrl).digest('hex')
}

/**
 * Models often capture two or three times when nothing on screen moved. Each call still
 * produced a transcript screenshot row even when repeat-call collapse shortened the model copy.
 * Drop pixel-identical captures within the same turn so the chat shows one frame.
 */
type ScopeEntry = { scope: string; surface: ScreenshotSurface; fingerprint: string; callId: string }

export class CaptureDedup {
  private turnId: string | null = null
  /** Last retained frame per scope (for example app_window or browser_page:tab-1). */
  private readonly byScope = new Map<string, ScopeEntry>()

  resetIfTurn(turnId: string | null): void {
    if (turnId !== this.turnId) {
      this.turnId = turnId
      this.byScope.clear()
    }
  }

  /** Prior capture call id when this scope already returned the same model JPEG this turn. */
  duplicate(scope: string, fingerprint: string): { callId: string; surface: ScreenshotSurface } | null {
    const previous = this.byScope.get(scope)
    if (previous?.fingerprint === fingerprint) return { callId: previous.callId, surface: previous.surface }
    return null
  }

  remember(scope: string, surface: ScreenshotSurface, fingerprint: string, callId: string): void {
    this.byScope.set(scope, { scope, surface, fingerprint, callId })
  }
}

export function duplicateCaptureText(surface: ScreenshotSurface, priorCallId: string): string {
  const label = surface === 'app_window' ? 'application window'
    : surface === 'browser_page' ? 'browser page'
      : 'crop'
  return (
    `Screenshot unchanged: the ${label} is pixel-identical to Capture ID ${priorCallId} ` +
    '(taken earlier this turn). No new image was stored. Use crop on that Capture ID for detail, ' +
    'or read_page / inspect_page to verify state without capturing again.'
  )
}
