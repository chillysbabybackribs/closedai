import type { WebContents } from 'electron'

/**
 * What a capture can honestly say about the pixels it returns. Attribution (same document) is
 * guarded separately; this records the interval, whether a fresh compositor frame was painted
 * before the read, and how much the DOM moved meanwhile. A capture is never rejected for
 * these — the model needs the image either way — but it must not be believed as verified when
 * the frame is possibly stale or the document was still changing.
 */
/**
 * painted: the visible document ran two animation frames right before the read.
 * settled: the document is hidden, so animation frames are paused and a paint probe cannot run;
 * its compositor folds DOM changes in on its own within tens of milliseconds (measured by
 * scripts/capture-coherence-live-check.mjs), so after that beat two consecutive captures were
 * byte-identical within a bounded settle window. It also coalesces rapid changes, so agreement
 * alone does not prove quiescence: the DOM mutation count is the other half of the verdict.
 * unsettled: consecutive captures never agreed — the hidden page is still changing.
 * unconfirmed: a visible document did not paint within the wait; the pixels may be stale.
 */
export type CaptureFrame = 'painted' | 'settled' | 'unsettled' | 'unconfirmed'
export type CaptureCoherence = {
  startedAt: string
  finishedAt: string
  intervalMs: number
  frame: CaptureFrame
  /** DOM mutations observed during the interval; null when the page could not be observed. */
  domMutations: number | null
  /** Coarse verdict for the model: verified when the frame is fresh and the DOM was quiet. */
  verdict: 'verified' | 'dom_changing' | 'pixels_changing' | 'possibly_stale' | 'unobserved'
}

/** How long a hidden compositor needs to composite a DOM change, with margin (measured 9–41ms). */
export const HIDDEN_CATCH_UP_MS = 60
/** Gap between consecutive captures that must agree for a hidden frame to count as settled. */
export const HIDDEN_STABILITY_GAP_MS = 40
/** A hidden page still delivering its first frames gets this long to settle before it is called changing. */
export const HIDDEN_SETTLE_BUDGET_MS = 400

const OBSERVER_KEY = '__closedaiCaptureObserver'
const OBSERVE_EXPRESSION = `(() => {
  try {
    const prior = window.${OBSERVER_KEY};
    if (prior) prior.observer.disconnect();
    const state = { count: 0, observer: null };
    state.observer = new MutationObserver((records) => { state.count += records.length; });
    state.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    window.${OBSERVER_KEY} = state;
    return true;
  } catch (error) { return false; }
})()`
const READ_EXPRESSION = `(() => {
  const state = window.${OBSERVER_KEY};
  if (!state) return null;
  state.observer.disconnect();
  delete window.${OBSERVER_KEY};
  return state.count;
})()`

type Runner = Pick<WebContents, 'executeJavaScript' | 'isDestroyed'>

/** Whether the document can run animation frames at all; a hidden one cannot. */
export async function documentHidden(contents: Runner): Promise<boolean> {
  return contents.executeJavaScript('document.visibilityState', true).then((value) => value === 'hidden', () => false)
}

/** Start counting DOM mutations in the page; returns the reader that stops counting. */
export async function observeDomMutations(contents: Runner): Promise<() => Promise<number | null>> {
  const started = await contents.executeJavaScript(OBSERVE_EXPRESSION, true).then((value) => value === true, () => false)
  return async () => {
    if (!started || contents.isDestroyed()) return null
    const count = await contents.executeJavaScript(READ_EXPRESSION, true).catch(() => null)
    return typeof count === 'number' ? count : null
  }
}

export function coherenceVerdict(frame: CaptureFrame, domMutations: number | null): CaptureCoherence['verdict'] {
  if (frame === 'unconfirmed') return 'possibly_stale'
  if (frame === 'unsettled') return 'pixels_changing'
  if (domMutations === null) return 'unobserved'
  return domMutations > 0 ? 'dom_changing' : 'verified'
}

const FRAME_TEXT: Record<CaptureFrame, string> = {
  painted: 'fresh frame painted',
  settled: 'hidden tab, two consecutive frames identical',
  unsettled: 'hidden tab, consecutive frames differ — the page is still changing',
  unconfirmed: 'no fresh frame within the wait — pixels may be stale'
}

export function describeCoherence(coherence: CaptureCoherence): string {
  const dom = coherence.domMutations === null ? 'DOM not observed'
    : coherence.domMutations === 0 ? 'DOM unchanged' : `DOM changed ${coherence.domMutations} time${coherence.domMutations === 1 ? '' : 's'}`
  return `Capture ${coherence.verdict.replace('_', ' ')}: ${FRAME_TEXT[coherence.frame]}; ${dom} over ${coherence.intervalMs}ms`
}
