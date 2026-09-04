// Post-detection page scripts for browser_dismiss_overlay. DETECTION is not here: the probe
// lives in overlay-probe.ts and is shared with browser_read_page, page_glance and the
// ambient overlay_state field, so the four cannot drift onto different selector lists again.
// Each script below keys off the token attribute that probe stamps on the winning element.

export const SEMANTIC_CLOSE_SCRIPT = `(token) => {
  const overlay = document.querySelector('[data-closedai-overlay-token="' + token + '"]')
  if (!(overlay instanceof HTMLElement)) return false
  if (overlay instanceof HTMLDialogElement && overlay.open) {
    overlay.close()
    return true
  }
  const visible = (element) => {
    if (!(element instanceof HTMLElement) || element.hidden) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const selectors = [
    '[data-bs-dismiss="modal"]', '[data-dismiss="modal"]',
    'button[aria-label*="close" i]', '[role="button"][aria-label*="close" i]',
    'button[title*="close" i]', '[role="button"][title*="close" i]'
  ]
  let control = null
  for (const selector of selectors) {
    control = [...overlay.querySelectorAll(selector)].find(visible) || null
    if (control) break
  }
  if (!control) {
    control = [...overlay.querySelectorAll('button,[role="button"]')]
      .find((element) => visible(element) && /^(close|dismiss|done|×|✕|✖)$/i.test(element.textContent?.trim() || '')) || null
  }
  if (!(control instanceof HTMLElement)) return false
  control.click()
  return true
}`

export const CLOSE_POINT_SCRIPT = `(token) => {
  const overlay = document.querySelector('[data-closedai-overlay-token="' + token + '"]')
  if (!(overlay instanceof HTMLElement)) return null
  const visible = (element) => {
    if (!(element instanceof HTMLElement) || element.hidden) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const selectors = [
    '[data-bs-dismiss="modal"]', '[data-dismiss="modal"]',
    'button[aria-label*="close" i]', '[role="button"][aria-label*="close" i]',
    'button[title*="close" i]', '[role="button"][title*="close" i]'
  ]
  let control = null
  for (const selector of selectors) {
    control = [...overlay.querySelectorAll(selector)].find(visible) || null
    if (control) break
  }
  if (!control) {
    control = [...overlay.querySelectorAll('button,[role="button"]')]
      .find((element) => visible(element) && /^(close|dismiss|done|×|✕|✖)$/i.test(element.textContent?.trim() || '')) || null
  }
  if (!(control instanceof HTMLElement)) return null
  const rect = control.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}`

export const VERIFY_DISMISSED_SCRIPT = `(token) => {
  const overlay = document.querySelector('[data-closedai-overlay-token="' + token + '"]')
  if (!(overlay instanceof HTMLElement)) return true
  const style = getComputedStyle(overlay)
  const rect = overlay.getBoundingClientRect()
  if (overlay.hidden || style.display === 'none' || style.visibility === 'hidden'
    || Number(style.opacity || 1) <= 0 || rect.width <= 0 || rect.height <= 0) return true
  if (overlay instanceof HTMLDialogElement && !overlay.open) return true
  if (overlay.getAttribute('aria-hidden') === 'true') return true
  if (overlay.getAttribute('data-state') === 'closed') return true
  if (overlay.classList.contains('modal') && !overlay.classList.contains('show')) return true
  return false
}`

export const CLEANUP_SCRIPT = `(token) => {
  const overlay = document.querySelector('[data-closedai-overlay-token="' + token + '"]')
  if (!overlay) return false
  overlay.removeAttribute('data-closedai-overlay-token')
  return true
}`

/** OneTrust / cookie-consent banners that Escape and semantic-close miss. Runs before Escape. */
export const CONSENT_ACCEPT_SCRIPT = `() => {
  const visible = (element) => {
    if (!(element instanceof HTMLElement) || element.hidden) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const selectors = [
    '#onetrust-accept-btn-handler',
    '#onetrust-banner-sdk #onetrust-accept-btn-handler',
    '#onetrust-pc-sdk #accept-recommended-btn-handler',
    '.onetrust-close-btn-handler'
  ]
  for (const selector of selectors) {
    const btn = document.querySelector(selector)
    if (btn instanceof HTMLElement && visible(btn)) {
      btn.click()
      return true
    }
  }
  const allow = [...document.querySelectorAll('button,[role="button"]')].find((element) => {
    if (!visible(element)) return false
    const text = (element.textContent || '').trim()
    return /^(allow all|accept all|accept cookies|i agree|confirm my choices)$/i.test(text)
  })
  if (allow instanceof HTMLElement) {
    allow.click()
    return true
  }
  return false
}`
