export type BrowserOverlayKind = 'auto' | 'modal' | 'dialog' | 'popover'
export type BrowserDismissStrategy = 'consent-accept' | 'escape' | 'semantic-close' | 'pointer'

export type BrowserOverlaySummary = {
  token: string
  kind: Exclude<BrowserOverlayKind, 'auto'>
  name: string | null
}

export type BrowserDismissError = {
  strategy: BrowserDismissStrategy
  message: string
}

export type BrowserDismissResult = {
  status: 'dismissed' | 'not_found' | 'still_open'
  strategy: BrowserDismissStrategy | null
  attempts: BrowserDismissStrategy[]
  errors: BrowserDismissError[]
  overlay: BrowserOverlaySummary | null
  durationMs: number
}

export type BrowserDismissAdapter = {
  inspect(): Promise<BrowserOverlaySummary | null>
  consentAccept(): Promise<boolean>
  sendEscape(): Promise<void>
  semanticClose(token: string): Promise<boolean>
  pointerClose(token: string): Promise<boolean>
  waitForDismissal(token: string, timeoutMs: number): Promise<boolean>
  cleanup(token: string): Promise<void>
}

type BrowserDismissRunOptions = {
  verifyTimeoutMs?: number
  now?: () => number
}

const DEFAULT_VERIFY_TIMEOUT_MS = 600
const MIN_VERIFY_TIMEOUT_MS = 100
const MAX_VERIFY_TIMEOUT_MS = 2_000

export async function runOverlayDismissal(
  adapter: BrowserDismissAdapter,
  options: BrowserDismissRunOptions = {}
): Promise<BrowserDismissResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const verifyTimeoutMs = boundedTimeout(options.verifyTimeoutMs)
  const overlay = await adapter.inspect()
  const attempts: BrowserDismissStrategy[] = []
  const errors: BrowserDismissError[] = []

  if (!overlay) {
    return { status: 'not_found', strategy: null, attempts, errors, overlay: null, durationMs: elapsed(now, startedAt) }
  }

  const attempt = async (
    strategy: BrowserDismissStrategy,
    action: () => Promise<boolean>
  ): Promise<boolean> => {
    attempts.push(strategy)
    try {
      const acted = await action()
      if (!acted) {
        attempts.pop()
        return false
      }
      return adapter.waitForDismissal(overlay.token, verifyTimeoutMs)
    } catch (error) {
      errors.push({ strategy, message: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  try {
    if (await attempt('consent-accept', () => adapter.consentAccept())) {
      return dismissedResult('consent-accept', overlay, attempts, errors, now, startedAt)
    }
    if (await attempt('escape', async () => {
      await adapter.sendEscape()
      return true
    })) {
      return dismissedResult('escape', overlay, attempts, errors, now, startedAt)
    }
    if (await attempt('semantic-close', () => adapter.semanticClose(overlay.token))) {
      return dismissedResult('semantic-close', overlay, attempts, errors, now, startedAt)
    }
    if (await attempt('pointer', () => adapter.pointerClose(overlay.token))) {
      return dismissedResult('pointer', overlay, attempts, errors, now, startedAt)
    }
    return {
      status: 'still_open', strategy: null, attempts, errors, overlay,
      durationMs: elapsed(now, startedAt)
    }
  } finally {
    await adapter.cleanup(overlay.token).catch(() => {})
  }
}

function dismissedResult(
  strategy: BrowserDismissStrategy,
  overlay: BrowserOverlaySummary,
  attempts: BrowserDismissStrategy[],
  errors: BrowserDismissError[],
  now: () => number,
  startedAt: number
): BrowserDismissResult {
  return {
    status: 'dismissed', strategy, attempts: [...attempts], errors: [...errors], overlay,
    durationMs: elapsed(now, startedAt)
  }
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_VERIFY_TIMEOUT_MS
  return Math.max(MIN_VERIFY_TIMEOUT_MS, Math.min(MAX_VERIFY_TIMEOUT_MS, Math.floor(value!)))
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, now() - startedAt)
}
