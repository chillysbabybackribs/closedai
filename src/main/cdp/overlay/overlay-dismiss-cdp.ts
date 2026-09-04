import {
  CLEANUP_SCRIPT,
  CLOSE_POINT_SCRIPT,
  CONSENT_ACCEPT_SCRIPT,
  SEMANTIC_CLOSE_SCRIPT,
  VERIFY_DISMISSED_SCRIPT
} from './overlay-dismiss-scripts.js'
import { asOverlayObservation, overlayProbeFunction } from './overlay-probe.js'
import {
  runOverlayDismissal,
  type BrowserDismissResult,
  type BrowserOverlayKind
} from './overlay-dismiss.js'

type CdpSend = (command: string, params?: Record<string, unknown>) => Promise<unknown>

type BrowserDismissOptions = {
  kind?: BrowserOverlayKind
  verifyTimeoutMs?: number
}

const DEFAULT_VERIFY_TIMEOUT_MS = 600
const MIN_VERIFY_TIMEOUT_MS = 100
const MAX_VERIFY_TIMEOUT_MS = 2_000
const VERIFY_INTERVAL_MS = 60
let nextOverlayToken = 1

export function dismissOverlayWithCdp(
  send: CdpSend,
  options: BrowserDismissOptions = {}
): Promise<BrowserDismissResult> {
  const kind = validKind(options.kind) ? options.kind : 'auto'
  const verifyTimeoutMs = boundedTimeout(options.verifyTimeoutMs)
  const token = `closedai-overlay-${Date.now()}-${nextOverlayToken++}`
  const evaluate = <T>(script: string, args: unknown[] = []) => evaluateCdp<T>(send, script, args)

  return runOverlayDismissal({
    // The shared probe (overlay-probe.ts) both finds the overlay and stamps it with our
    // token, which is what the close/verify/cleanup scripts below key off. Dismissal used to own
    // a private selector list; it is now the same detector browser_read_page, page_glance and the
    // ambient overlay_state field use, so all four can never disagree about what is on top again.
    inspect: async () => {
      const observation = asOverlayObservation(
        await evaluate<unknown>(overlayProbeFunction(), [token, kind])
      )
      return observation ? { token, kind: observation.kind, name: observation.name } : null
    },
    consentAccept: () => evaluate<boolean>(CONSENT_ACCEPT_SCRIPT, []),
    sendEscape: async () => {
      const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    },
    semanticClose: (overlayToken) => evaluate<boolean>(SEMANTIC_CLOSE_SCRIPT, [overlayToken]),
    pointerClose: async (overlayToken) => {
      const point = await evaluate<{ x: number; y: number } | null>(CLOSE_POINT_SCRIPT, [overlayToken])
      if (!point) return false
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1
      })
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1
      })
      return true
    },
    waitForDismissal: async (overlayToken, timeoutMs) => {
      const deadline = Date.now() + timeoutMs
      do {
        if (await evaluate<boolean>(VERIFY_DISMISSED_SCRIPT, [overlayToken])) return true
        await delay(Math.min(VERIFY_INTERVAL_MS, Math.max(0, deadline - Date.now())))
      } while (Date.now() < deadline)
      return evaluate<boolean>(VERIFY_DISMISSED_SCRIPT, [overlayToken])
    },
    cleanup: async (overlayToken) => {
      await evaluate<boolean>(CLEANUP_SCRIPT, [overlayToken])
    }
  }, { verifyTimeoutMs })
}

async function evaluateCdp<T>(send: CdpSend, script: string, args: unknown[]): Promise<T> {
  const response = await send('Runtime.evaluate', {
    expression: `(${script})(...${JSON.stringify(args)})`,
    returnByValue: true,
    awaitPromise: true
  }) as {
    result?: { value?: unknown; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? response.result?.description
      ?? 'Browser overlay script failed'
    )
  }
  return response.result?.value as T
}

function validKind(value: BrowserOverlayKind | undefined): value is BrowserOverlayKind {
  return value === 'auto' || value === 'modal' || value === 'dialog' || value === 'popover'
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_VERIFY_TIMEOUT_MS
  return Math.max(MIN_VERIFY_TIMEOUT_MS, Math.min(MAX_VERIFY_TIMEOUT_MS, Math.floor(value!)))
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}
