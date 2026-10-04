/** Trim trailing slashes for stable folder identity comparisons. */
export function normalizeProjectPath(path: string): string {
  return path.replace(/[\\/]+$/, '') || path
}

export function sameProjectPath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left == null || right == null) return left === right
  return normalizeProjectPath(left) === normalizeProjectPath(right)
}

/** Known retired ClosedAI checkout locations on this machine; rewritten to the live app checkout. */
export const RETIRED_HOST_CHECKOUT_PATHS: readonly string[] = [
  '/home/dp/Desktop/closedai',
  '/home/dp/Desktop/close/closedai'
]

export function isRetiredHostCheckoutPath(path: string | null | undefined): boolean {
  if (!path) return false
  const normalized = normalizeProjectPath(path)
  return RETIRED_HOST_CHECKOUT_PATHS.some((retired) => normalizeProjectPath(retired) === normalized)
}

/** Map a retired host checkout path to the running app's checkout; leave other paths unchanged. */
export function rewriteRetiredHostCheckoutPath(path: string | null, liveCheckout: string): string | null {
  if (!path) return null
  return isRetiredHostCheckoutPath(path) ? liveCheckout : path
}
