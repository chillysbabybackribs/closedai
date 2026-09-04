import type {
  AppConditionProbe,
  AppControl,
  AppControlFilter,
  AppUiState,
  AppUiTarget,
  AppWaitOptions
} from './tools/app/host.js'

// Renderer-side expressions for the ui host. Every function below that runs in the page is
// stringified into the expression, so each takes its helpers as parameters instead of closing
// over module scope. Controls are addressed by their manifest id (`data-ui`), never by refs
// from an earlier snapshot, so no result has to be replayed for a later action to work.

export type AppPreparedClick = {
  point: { x: number; y: number }
  viewport: { width: number; height: number }
}

const helpers = (): string => `
  const visible = (${viewportVisible.toString()});
  const nameOf = (${accessibleName.toString()});
  const surfaceOf = (${surfaceOfElement.toString()});
  const describe = (${describeControl.toString()});
  const select = (${selectRenderedElement.toString()});
`

/** List the rendered manifest controls, optionally scoped to a surface and filtered by text. */
export function controlsExpression(filter: AppControlFilter): string {
  return `(() => {
    ${helpers()}
    const filter = ${JSON.stringify(filter)};
    const query = (filter.query || '').toLowerCase();
    const surfaces = Array.from(document.querySelectorAll('[data-ui-surface]'))
      .filter(visible).map((element) => element.getAttribute('data-ui-surface'));
    const controls = [];
    let total = 0;
    for (const element of Array.from(document.querySelectorAll('[data-ui]'))) {
      if (!visible(element)) continue;
      const item = describe(element, nameOf, surfaceOf);
      if (filter.surface && item.surface !== filter.surface) continue;
      if (query) {
        const haystack = [item.id, item.item, item.name, item.value].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      total += 1;
      if (controls.length < filter.maxControls) controls.push(item);
    }
    return { surfaces, controls, total, omitted: total - controls.length };
  })()`
}

/** Renderer-only facts the main process cannot know: open overlays, drawer, composer, focus. */
export function uiStateExpression(): string {
  return `(() => {
    ${helpers()}
    const byId = (id) => Array.from(document.querySelectorAll('[data-ui="' + id + '"]'))
      .find((element) => visible(element) && (!element.closest('[data-pane-id]') || element.closest('[data-pane-id]').getAttribute('data-selected') === 'true')) || null;
    const ids = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible)
      .map((element) => element.getAttribute('data-ui') || element.getAttribute('aria-label') || element.tagName.toLowerCase());
    const input = byId('composer.input');
    const send = byId('composer.send');
    const active = document.activeElement;
    const focused = active && active.closest ? active.closest('[data-ui]') : null;
    return {
      drawerOpen: Boolean(document.querySelector('[data-ui-surface="side-drawer"]')),
      layout: {
        visiblePaneIds: Array.from(document.querySelectorAll('[data-pane-id]')).map((element) => element.getAttribute('data-pane-id')),
        browserVisible: document.querySelector('[data-ui="layout.browser-toggle"]')?.getAttribute('aria-pressed') !== 'false'
      },
      historyOpen: Boolean(byId('chat.history')),
      downloadsOpen: Boolean(document.querySelector('[data-ui-surface="browser-downloads"]')),
      dialogs: ids('[role="dialog"][data-ui]'),
      menus: ids('[role="menu"], [role="listbox"], [role="menubar"] [data-state="open"]'),
      composer: input ? {
        enabled: !input.disabled,
        running: Boolean(byId('composer.stop')),
        canSend: Boolean(send) && !send.disabled,
        draftLength: (input.value || '').length
      } : null,
      focused: focused ? {
        id: focused.getAttribute('data-ui'),
        ...(focused.getAttribute('data-ui-key') ? { item: focused.getAttribute('data-ui-key') } : {})
      } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  })()`
}

/** Resolve a target at action time and enforce the click contract (enabled, scrolled, unobscured). */
export function targetClickExpression(target: AppUiTarget): string {
  return `(async () => {
    ${helpers()}
    const prepare = (${prepareSelectedClick.toString()});
    return await prepare(select(${JSON.stringify(target)}, visible, nameOf));
  })()`
}

export function targetTypeExpression(target: AppUiTarget, clear: boolean): string {
  return `(() => {
    ${helpers()}
    return (${prepareSelectedType.toString()})(select(${JSON.stringify(target)}, visible, nameOf), ${clear});
  })()`
}

export function targetValueExpression(target: AppUiTarget): string {
  return `(() => {
    ${helpers()}
    return (${readSelectedValue.toString()})(select(${JSON.stringify(target)}, visible, nameOf));
  })()`
}

export function targetScrollExpression(target: AppUiTarget): string {
  return `(() => {
    ${helpers()}
    const element = select(${JSON.stringify(target)}, visible, nameOf);
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return { scrolled: 'into_view', control: element.getAttribute('data-ui') || undefined };
  })()`
}

/** One probe per poll: counts of rendered/enabled target matches and whether text is on screen. */
export function conditionProbeExpression(options: AppWaitOptions): string {
  const target = targetSelector(options)
  return `(() => {
    ${helpers()}
    const selector = ${JSON.stringify(target)};
    const match = ${JSON.stringify(options.match?.toLowerCase() ?? '')};
    const needle = ${JSON.stringify(options.text ?? '')};
    let targetVisible = null;
    let targetEnabled = null;
    if (selector) {
      const rendered = Array.from(document.querySelectorAll(selector)).filter(visible)
        .filter((element) => !match || nameOf(element).toLowerCase().includes(match));
      targetVisible = rendered.length;
      targetEnabled = rendered.filter((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true').length;
    }
    let textMatched = null;
    if (needle && document.body) {
      textMatched = false;
      for (const element of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
        if (visible(element) && nameOf(element).includes(needle)) { textMatched = true; break; }
      }
      if (!textMatched) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if ((node.nodeValue || '').includes(needle) && node.parentElement && visible(node.parentElement)) {
            textMatched = true;
            break;
          }
        }
      }
    }
    return { targetVisible, targetEnabled, textMatched };
  })()`
}

export function targetSelector(target: AppUiTarget): string {
  if (target.selector) return target.selector
  if (!target.control) return ''
  return `[data-ui="${target.control}"]${target.item ? `[data-ui-key="${target.item}"]` : ''}`
}

type Visible = (element: Element) => boolean
type NameOf = (element: Element) => string
type SurfaceOf = (element: Element) => string

function selectRenderedElement(target: AppUiTarget, visible: Visible, nameOf: NameOf): Element {
  const selector = target.selector ??
    (target.control ? `[data-ui="${target.control}"]${target.item ? `[data-ui-key="${target.item}"]` : ''}` : '')
  if (!selector) throw new Error('Pass control (with item or match when it repeats) or selector')
  const all = Array.from(document.querySelectorAll(selector))
  const rendered = all.filter((element) => {
    if (!element.isConnected || !visible(element)) return false
    if (!target.selector && /^(chat|composer)\./.test(target.control ?? '')) {
      const pane = element.closest?.('[data-pane-id]')
      if (pane && pane.getAttribute('data-selected') !== 'true') return false
    }
    return true
  })
  const match = target.match?.toLowerCase()
  const candidates = match ? rendered.filter((element) => nameOf(element).toLowerCase().includes(match)) : rendered
  if (candidates.length === 0) {
    const where = target.control ?? selector
    if (all.length === 0) throw new Error(`Control ${where} is not rendered now (open its surface or menu first)`)
    if (rendered.length === 0) throw new Error(`Control ${where} exists but is not visible`)
    throw new Error(`No visible ${where} matches "${target.match}"`)
  }
  if (candidates.length > 1) {
    const options = candidates.slice(0, 8)
      .map((element) => `${element.getAttribute('data-ui-key') ?? '?'}: ${nameOf(element).slice(0, 60)}`)
    throw new Error(`Control ${target.control ?? selector} matches ${candidates.length} elements; pass item or match. Items: ${options.join(' | ')}`)
  }
  return candidates[0]!
}

async function prepareSelectedClick(element: Element): Promise<AppPreparedClick> {
  if (('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) ||
      element.getAttribute('aria-disabled') === 'true') {
    throw new Error('Element is disabled')
  }
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  await Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    new Promise<void>((resolve) => setTimeout(resolve, 200))
  ])
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

function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby')
  const labelledText = labelledBy?.split(/\s+/)
    .map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim()
  const name = labelledText || element.getAttribute('aria-label') || element.getAttribute('title') ||
    element.getAttribute('placeholder') || element.getAttribute('alt') ||
    ((element as HTMLElement).innerText || element.textContent || '')
  return name.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function surfaceOfElement(element: Element): string {
  return element.closest('[data-ui-surface]')?.getAttribute('data-ui-surface') ?? 'overlay'
}

function describeControl(element: Element, nameOf: NameOf, surfaceOf: SurfaceOf): AppControl {
  const html = element as HTMLInputElement
  const tag = element.tagName.toLowerCase()
  const item: AppControl = {
    id: element.getAttribute('data-ui') ?? '',
    name: nameOf(element),
    role: element.getAttribute('role') || (tag === 'input' ? html.type || 'text' : tag),
    surface: surfaceOf(element)
  }
  const key = element.getAttribute('data-ui-key')
  if (key) item.item = key
  if (('disabled' in html && Boolean(html.disabled)) || element.getAttribute('aria-disabled') === 'true') item.disabled = true
  if (tag === 'input' && (html.type === 'checkbox' || html.type === 'radio')) item.checked = html.checked
  if (element.getAttribute('aria-checked') !== null) item.checked = element.getAttribute('aria-checked') === 'true'
  for (const state of ['selected', 'expanded', 'pressed'] as const) {
    const value = element.getAttribute(`aria-${state}`)
    if (value === 'true' || value === 'false') item[state] = value === 'true'
  }
  if (element.getAttribute('aria-current') === 'true') item.current = true
  if ((tag === 'input' && html.type !== 'file') || tag === 'textarea') {
    const value = html.value ?? ''
    if (value) item.value = value.slice(0, 120)
  }
  return item
}

export type { AppUiState, AppConditionProbe }
