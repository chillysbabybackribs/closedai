import type { WebContents } from 'electron'

// A view that has just been made visible has no fresh compositor frame yet. Chromium routes both
// real input and window capture against that compositor, so acting before the first frame lands
// is how a click goes nowhere and a screenshot comes back blank. Two rAFs mean the page has
// actually painted once, not merely that script ran.
const FRAME_TIMEOUT_MS = 1_500

/** Wait until a page has painted a frame; give up on the timeout so a stalled page cannot block. */
export async function settleFrames(contents: WebContents, timeoutMs = FRAME_TIMEOUT_MS): Promise<void> {
  if (contents.isDestroyed()) return
  // A page that navigates mid-settle rejects the evaluation; that is a settled frame's worth of
  // waiting either way, so fall through instead of failing the operation that needed the frame.
  const painted = contents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true
  ).then(() => {}, () => {})
  await Promise.race([
    painted,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    })
  ])
}
