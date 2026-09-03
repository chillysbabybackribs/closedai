import { inspectionExpression } from './cdp/page-control/runtime.js'
import type { AppElementMatch, AppWaitOptions } from './tools/app/host.js'

export type AppConditionProbe = {
  selectorMatched: boolean | null
  textMatched: boolean | null
  matches: AppElementMatch[]
}

export type AppPreparedSelector = {
  point: { x: number; y: number }
  viewport: { width: number; height: number }
}

/** One bounded renderer evaluation; avoids the browser inspector's frame and geometry traversal. */
export function appInspectionExpression(snapshotId: string, maxElements: number): string {
  const inspect = inspectionExpression(snapshotId, 'app', maxElements)
  return `(() => {
    const inspection = ${inspect};
    const visible = (${viewportVisible.toString()});
    const describe = (${describeElement.toString()});
    const visibleText = (${readVisibleText.toString()})(8000);
    const active = document.activeElement;
    return {
      inspection,
      document: {
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        activeElement: active && active instanceof HTMLElement ? describe(active) : null,
        surfaces: Array.from(document.querySelectorAll('[data-ui-surface], [role="dialog"], [role="alert"], [role="status"]'))
          .filter(visible).slice(0, 100).map(describe),
        visibleText: visibleText.text,
        textTruncated: visibleText.truncated
      }
    };
  })()`
}

/** Build a focused probe: selector-only waits never read or lay out the document's text. */
export function conditionProbeExpression(options: AppWaitOptions): string {
  return `(() => {
    const selector = ${JSON.stringify(options.selector ?? '')};
    const needle = ${JSON.stringify(options.text ?? '')};
    const visible = (${viewportVisible.toString()});
    const describe = (${describeElement.toString()});
    const selected = selector ? Array.from(document.querySelectorAll(selector)).filter(visible) : [];
    const textMatches = [];
    if (needle && document.body) {
      const seen = new Set();
      const add = (element) => {
        const semantic = element.closest('a[href],button,input,select,textarea,summary,[role],[tabindex],[contenteditable="true"]') || element;
        if (!seen.has(semantic) && visible(semantic)) {
          seen.add(semantic);
          textMatches.push(semantic);
        }
      };
      for (const element of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
        const accessible = [
          element.getAttribute('aria-label'), element.getAttribute('title'),
          element.getAttribute('placeholder'), element.getAttribute('alt')
        ].filter(Boolean).join(' ');
        if (accessible.includes(needle)) add(element);
        if (textMatches.length >= 5) break;
      }
      if (textMatches.length < 5) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && textMatches.length < 5) {
          if ((node.nodeValue || '').includes(needle) && node.parentElement) add(node.parentElement);
        }
      }
    }
    const matched = Array.from(new Set([...selected, ...textMatches])).slice(0, 5);
    return {
      selectorMatched: selector ? selected.length > 0 : null,
      textMatched: needle ? textMatches.length > 0 : null,
      matches: matched.map(describe)
    };
  })()`
}

/** Resolve a selector at action time and enforce the same click contract as inspected refs. */
export function selectorClickExpression(selector: string): string {
  return `(async () => {
    const select = (${selectRenderedElement.toString()});
    const prepare = (${prepareSelectedClick.toString()});
    return await prepare(select(${JSON.stringify(selector)}));
  })()`
}

/** Verify the selector still resolves to an editable control and prepare replacement typing. */
export function selectorTypeExpression(selector: string, clear: boolean): string {
  return `(() => {
    const select = (${selectRenderedElement.toString()});
    return (${prepareSelectedType.toString()})(select(${JSON.stringify(selector)}), ${clear});
  })()`
}

/** Read the post-input value so callers can verify what the renderer accepted. */
export function selectorValueExpression(selector: string): string {
  return `(() => {
    const select = (${selectRenderedElement.toString()});
    return (${readSelectedValue.toString()})(select(${JSON.stringify(selector)}));
  })()`
}

function selectRenderedElement(selector: string): Element {
  const matches = Array.from(document.querySelectorAll(selector))
  const element = matches.find((candidate) => {
    if (!candidate.isConnected) return false
    const style = getComputedStyle(candidate)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    return Array.from(candidate.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)
  })
  if (!element) throw new Error('No rendered element matched selector: ' + selector)
  return element
}

async function prepareSelectedClick(element: Element): Promise<AppPreparedSelector> {
  if (('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) ||
      element.getAttribute('aria-disabled') === 'true') {
    throw new Error('Element is disabled')
  }
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  let point: { x: number; y: number } | null = null
  let area = 0
  for (const rect of Array.from(element.getClientRects())) {
    const left = Math.max(0, rect.left)
    const top = Math.max(0, rect.top)
    const right = Math.min(window.innerWidth, rect.right)
    const bottom = Math.min(window.innerHeight, rect.bottom)
    const candidateArea = Math.max(0, right - left) * Math.max(0, bottom - top)
    if (candidateArea > area) {
      area = candidateArea
      point = { x: (left + right) / 2, y: (top + bottom) / 2 }
    }
  }
  if (!point) throw new Error('Element is not visible after scrolling')
  const hit = document.elementFromPoint(point.x, point.y)
  if (!hit || (hit !== element && !element.contains(hit))) {
    throw new Error('Element is covered at its clickable center')
  }
  return { point, viewport: { width: window.innerWidth, height: window.innerHeight } }
}

function prepareSelectedType(element: Element, clear: boolean): boolean {
  const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
  if (field) {
    if (field.readOnly || field.disabled) throw new Error('Element is read-only or disabled')
    field.focus()
    if (clear) field.select()
    return true
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus()
    if (clear) {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    return true
  }
  throw new Error('Element is not an input, textarea, or contenteditable element')
}

function readSelectedValue(element: Element): { value: string | null } {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return { value: element.value.slice(0, 200) }
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return { value: (element.textContent ?? '').slice(0, 200) }
  }
  return { value: null }
}

function viewportVisible(element: Element): boolean {
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  return Array.from(element.getClientRects()).some((rect) => (
    rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
    rect.left < window.innerWidth && rect.top < window.innerHeight
  ))
}

function describeElement(element: Element): AppElementMatch {
  const html = element as HTMLElement
  const rect = element.getBoundingClientRect()
  const labelledBy = element.getAttribute('aria-labelledby')
  const labelledText = labelledBy?.split(/\s+/)
    .map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim()
  const name = labelledText || element.getAttribute('aria-label') || element.getAttribute('title') ||
    element.getAttribute('placeholder') || element.getAttribute('alt') ||
    (html.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
  const state: Record<string, boolean | string> = {}
  if ('disabled' in html) state.disabled = Boolean((html as HTMLButtonElement).disabled)
  if ('checked' in html) state.checked = Boolean((html as HTMLInputElement).checked)
  if ('value' in html && typeof (html as HTMLInputElement).value === 'string') {
    state.value = (html as HTMLInputElement).value.slice(0, 500)
  }
  for (const key of ['expanded', 'pressed', 'selected'] as const) {
    const value = element.getAttribute(`aria-${key}`)
    if (value === 'true' || value === 'false') state[key] = value === 'true'
  }
  return {
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || element.tagName.toLowerCase(),
    name: name.slice(0, 500),
    text: (html.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    state,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
}

function readVisibleText(limit: number): { text: string; truncated: boolean } {
  if (!document.body) return { text: '', truncated: false }
  const parts: string[] = []
  let length = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim()
    const parent = node.parentElement
    if (!text || !parent) continue
    const style = getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const inViewport = Array.from(range.getClientRects()).some((rect) => (
      rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
      rect.left < window.innerWidth && rect.top < window.innerHeight
    ))
    if (!inViewport) continue
    if (length + text.length + 1 > limit) {
      const remaining = Math.max(0, limit - length)
      if (remaining > 0) parts.push(text.slice(0, remaining))
      return { text: parts.join(' '), truncated: true }
    }
    parts.push(text)
    length += text.length + 1
  }
  return { text: parts.join(' '), truncated: false }
}
