// Bounded navigation wait: return once the page is usable rather than fully loaded.
// Electron's loadURL resolves at did-finish-load — after every ad/analytics
// subresource — which held navigation callers hostage to the slowest third-party
// request. The DOM is interactive at dom-ready; a short settle lets first-paint
// scripts run, and the hard cap keeps a never-finishing page from stalling the turn
// (the caller's state snapshot reports isLoading). Main-frame failures still reject:
// they arrive well before either timer.

export const NAVIGATION_SETTLE_MS = 500
export const NAVIGATION_WAIT_CAP_MS = 12_000

// The slice of WebContents this wait needs; tests substitute a plain emitter.
export type DomReadySource = {
  once(event: 'dom-ready', listener: () => void): unknown
  removeListener(event: 'dom-ready', listener: () => void): unknown
}

export async function waitForUsableLoad(
  contents: DomReadySource,
  load: Promise<void>,
  settleMs = NAVIGATION_SETTLE_MS,
  capMs = NAVIGATION_WAIT_CAP_MS,
  settleSignal?: () => Promise<void>
): Promise<void> {
  let onDomReady: (() => void) | null = null
  const domReadySettled = new Promise<void>((resolve) => {
    onDomReady = () => resolve()
    contents.once('dom-ready', onDomReady)
  }).then(() => settle(settleMs, settleSignal))
  try {
    await Promise.race([load, domReadySettled, sleep(capMs)])
  } finally {
    if (onDomReady) contents.removeListener('dom-ready', onDomReady)
  }
}

// The settle exists to let first-paint scripts run after dom-ready. Given a real signal
// (the caller's double-rAF probe: the renderer produced a frame after scripts ran), the
// fixed tail is pure latency — so the signal races the sleep and the sleep demotes to a
// cap. A failed or never-answering probe (hidden tab throttles rAF, page tore down)
// falls back to exactly the old fixed wait rather than cutting the settle short.
function settle(settleMs: number, signal?: () => Promise<void>): Promise<void> {
  if (!signal) return sleep(settleMs)
  const signalled = signal().catch(() => new Promise<void>(() => {}))
  return Promise.race([signalled, sleep(settleMs)])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
