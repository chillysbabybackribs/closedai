import type {
  AppConditionProbe,
  AppControl,
  AppControlFilter,
  AppUiState,
  AppUiTarget,
  AppWaitOptions
} from './tools/app/host.js'
import { APP_REVEAL_BROWSER_EVENT, APP_REVEAL_CHAT_TAB_EVENT } from '../shared/app-ui-events.js'

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
    const surfaces = Array.from(new Set(Array.from(document.querySelectorAll('[data-ui-surface]'))
      .filter(visible).map((element) => element.getAttribute('data-ui-surface'))));
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

/** Renderer-only facts the main process cannot know: open overlays, chat search, composer, focus. */
export function uiStateExpression(): string {
  return `(() => {
    ${helpers()}
    const byId = (id) => Array.from(document.querySelectorAll('[data-ui="' + id + '"]'))
      .find((element) => visible(element) && (!element.closest('[data-pane-id]') || element.closest('[data-pane-id]').getAttribute('data-selected') === 'true')) || null;
    // Portalled popovers (Radix menu/listbox content) carry no data-ui; name them by their trigger,
    // else by the labelled container around them (a cmdk listbox only says "Suggestions").
    const labelledBy = (element) => {
      const trigger = element.getAttribute('aria-labelledby');
      const owner = trigger ? document.getElementById(trigger) : null;
      return owner && owner.getAttribute('data-ui');
    };
    const container = (element) => {
      const parent = element.parentElement ? element.parentElement.closest('[data-ui], [aria-label]') : null;
      return parent && (parent.getAttribute('data-ui') || parent.getAttribute('aria-label'));
    };
    const ids = (selector) => Array.from(new Set(Array.from(document.querySelectorAll(selector)).filter(visible)
      .map((element) => element.getAttribute('data-ui') || labelledBy(element) || container(element) ||
        element.getAttribute('aria-label') || element.tagName.toLowerCase())));
    const input = byId('composer.input');
    const active = document.activeElement;
    const focused = active && active.closest ? active.closest('[data-ui]') : null;
    return {
      chatSearchOpen: byId('titlebar.chat-search')?.getAttribute('aria-expanded') === 'true',
      layout: {
        visiblePaneIds: Array.from(document.querySelectorAll('[data-pane-id]')).map((element) => element.getAttribute('data-pane-id')),
        browserVisible: document.querySelector('.workspace-right[data-mode="browser"]')?.getAttribute('data-with-browser') === 'yes'
      },
      historyOpen: Boolean(byId('chat.history')),
      downloadsOpen: Boolean(document.querySelector('[data-ui-surface="browser-downloads"]')),
      dialogs: ids('[role="dialog"][data-ui]'),
      menus: ids('[role="menu"], [role="listbox"], [role="menubar"] [data-state="open"]'),
      composer: input ? {
        enabled: !input.disabled,
        running: Boolean(byId('composer.stop')),
        canSend: input.getAttribute('data-can-send') === 'true',
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
/** True when an unmodified Escape would pause a running turn (matches App.tsx pause-task gate). */
export function escapeWouldPauseTaskExpression(): string {
  return `(() => {
    const overlayOpen = Boolean(document.querySelector(
      '[role="dialog"], [role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper], .radix-dropdown-menu-content'
    ));
    if (overlayOpen) return false;
    if (Boolean(document.querySelector('.chat-layout-tile[data-solo="true"]'))) return false;
    if (document.body.hasAttribute('data-layout-resize') || Boolean(document.querySelector('[data-layout-drag]'))) return false;
    const active = document.activeElement;
    let pauses = false;
    if (!active) pauses = true;
    else if (active.getAttribute('data-ui') === 'composer.input') pauses = true;
    else {
      const tag = active.tagName.toUpperCase();
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        const editable = active.getAttribute('contenteditable');
        pauses = !(active.isContentEditable || (editable !== null && editable !== 'false'));
      }
    }
    if (!pauses) return false;
    return Boolean(document.querySelector('[data-ui="composer.stop"]'));
  })()`
}

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
      // Agent strip controls sit in a visible tile that may not carry data-selected=true in multi-tab headers.
      if (/^chat\.agent-/.test(target.control ?? '')) return true
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
    if (rendered.length === 0) {
      const inOtherPane = all.find((element) => {
        const pane = element.closest?.('[data-pane-id]')
        return pane && pane.getAttribute('data-selected') !== 'true'
      })
      if (inOtherPane) {
        const paneId = inOtherPane.closest?.('[data-pane-id]')?.getAttribute('data-pane-id') ?? 'another pane'
        throw new Error(`Control ${where} exists but is not visible in the selected chat pane (it belongs to unselected pane ${paneId})`)
      }
      throw new Error(`Control ${where} exists but is not visible`)
    }
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
    const id = element.getAttribute('data-ui') || element.tagName.toLowerCase()
    const reason = element.getAttribute('aria-disabled') === 'true' ? 'aria-disabled="true"' : 'disabled attribute'
    throw new Error(`Element is disabled: ${id} (${reason})`)
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
  // A wide control can have a sibling floated over its centre (the composer's agent button sits
  // over the model trigger), so fall back to its own children and off-centre points before failing.
  const candidates = [point]
  for (const child of Array.from(element.children)) {
    const rect = child.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) candidates.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }
  const box = element.getBoundingClientRect()
  for (const fraction of [0.15, 0.85]) candidates.push({ x: box.left + box.width * fraction, y: point.y })
  let cover: string | null = null
  for (const candidate of candidates) {
    if (candidate.x < 0 || candidate.y < 0 || candidate.x > window.innerWidth || candidate.y > window.innerHeight) continue
    const hit = document.elementFromPoint(candidate.x, candidate.y)
    if (hit && (hit === element || element.contains(hit))) {
      return { point: candidate, viewport: { width: window.innerWidth, height: window.innerHeight } }
    }
    cover ??= hit
      ? (hit.getAttribute('data-ui') ? `[data-ui="${hit.getAttribute('data-ui')}"]` : (hit.className ? `.${String(hit.className).trim().split(/\s+/)[0]}` : hit.tagName.toLowerCase()))
      : 'viewport boundary'
  }
  throw new Error(`Element is covered at its clickable center by ${cover}`)
}

function prepareSelectedType(element: Element, clear: boolean): boolean {
  const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
  if (field) {
    if (field.readOnly || field.disabled) {
      const id = field.getAttribute('data-ui') || field.tagName.toLowerCase()
      const reason = field.readOnly ? 'read-only' : 'disabled'
      throw new Error(`Element is read-only or disabled: ${id} (${reason})`)
    }
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
  // Native <label for> associations name inputs and Radix switches that carry no aria-label.
  const labels = (element as HTMLInputElement).labels
  const labelText = labels && labels.length
    ? Array.from(labels).map((label) => label.innerText || label.textContent || '').join(' ').trim() : ''
  const name = labelledText || element.getAttribute('aria-label') || labelText || element.getAttribute('title') ||
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
  const pane = element.closest?.('[data-pane-id]')?.getAttribute('data-pane-id')
  if (pane) item.pane = pane
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

/** Ask the renderer to bring a chat tab to the front when a view tab is covering it. */
export function revealChatTabExpression(paneId: string): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(APP_REVEAL_CHAT_TAB_EVENT)}, { detail: { paneId: ${JSON.stringify(paneId)} } }))`
}

/** Ask the renderer to show the browser pane in its saved position, the way the dock's Browser icon does. */
export function revealBrowserExpression(): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(APP_REVEAL_BROWSER_EVENT)}))`
}

export type { AppUiState, AppConditionProbe }
