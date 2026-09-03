import type { BrowserWindow, WebContents } from 'electron'
import type {
  AppClickTarget,
  AppElementMatch,
  AppScrollTarget,
  AppToolHost,
  AppTypeTarget,
  AppWaitOptions,
  AppWaitResult
} from './tools/app/host.js'
import { CdpSession } from './cdp/cdp-session.js'
import { CdpPageController } from './cdp/page-control/page-controller.js'
import { CdpPageInput } from './cdp/page-control/page-input.js'
import {
  inspectionExpression,
  prepareClickExpression,
  prepareTypeExpression,
  readValueExpression,
  scrollRefExpression,
  type LocalInspection
} from './cdp/page-control/runtime.js'

type Connection = {
  session: CdpSession
  page: CdpPageController
  input: CdpPageInput
}

type ConditionProbe = {
  selectorMatched: boolean | null
  textMatched: boolean | null
  matches: AppElementMatch[]
}

const APP_TARGET_ID = 'closedai-app'
const POLL_MS = 75

/** Electron adapter for semantic model interaction with the app renderer itself. */
export class AppAutomationAccess implements AppToolHost {
  private connection: Connection | null = null
  private snapshotId: string | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  async inspect(maxElements: number): Promise<unknown> {
    const { window, contents, session } = this.resolve()
    const snapshotId = `a${crypto.randomUUID().slice(0, 8)}`
    const result = await contents.executeJavaScript(
      appInspectionExpression(snapshotId, maxElements), true
    ) as { inspection: LocalInspection; document: unknown }
    this.snapshotId = snapshotId
    return {
      window: {
        title: window.getTitle(), focused: window.isFocused(), visible: window.isVisible(),
        minimized: window.isMinimized(), maximized: window.isMaximized(), bounds: window.getBounds()
      },
      document: result.document,
      connectionId: session.connectionId,
      snapshotId,
      coordinateSpace: 'main_viewport_css',
      viewport: result.inspection.viewport,
      elements: result.inspection.elements,
      truncated: result.inspection.candidateCount > result.inspection.elements.length
    }
  }

  async click(target: AppClickTarget): Promise<unknown> {
    const { contents, session, page } = this.resolve()
    if (typeof target.x === 'number' && typeof target.y === 'number') {
      return { connectionId: session.connectionId, ...await page.clickAt({ x: target.x, y: target.y }) }
    }
    if (target.selector) {
      const point = await contents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)});
        if (!el) throw new Error('No element matched selector: ' + ${JSON.stringify(target.selector)});
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`, true) as { x: number; y: number }
      const clickResult = await page.clickAt(point)
      return { connectionId: session.connectionId, selector: target.selector, ...clickResult }
    }
    if (target.ref) {
      const snapshotId = this.requireSnapshot(target.ref)
      const prepared = await contents.executeJavaScript(
        prepareClickExpression(snapshotId, target.ref), true
      ) as { point: { x: number; y: number } }
      return { connectionId: session.connectionId, ref: target.ref, ...await page.clickAt(prepared.point) }
    }
    throw new Error('click requires selector, (x, y) coordinates, or ref')
  }

  async typeText(target: AppTypeTarget): Promise<unknown> {
    const { contents, session, page, input } = this.resolve()
    if (target.selector) {
      const point = await contents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)});
        if (!el) throw new Error('No element matched selector: ' + ${JSON.stringify(target.selector)});
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (typeof (el as HTMLElement).focus === 'function') (el as HTMLElement).focus();
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`, true) as { x: number; y: number }
      await page.clickAt(point)
      if (target.clear) {
        await input.pressKey('a', ['ctrl'])
        await input.pressKey('Backspace', [])
      }
      await session.command('Input.insertText', { text: target.text })
      return { connectionId: session.connectionId, selector: target.selector, text: target.text }
    }
    if (target.ref) {
      const snapshotId = this.requireSnapshot(target.ref)
      const prepared = await contents.executeJavaScript(
        prepareClickExpression(snapshotId, target.ref), true
      ) as { point: { x: number; y: number } }
      await page.clickAt(prepared.point)
      await contents.executeJavaScript(prepareTypeExpression(snapshotId, target.ref, target.clear), true)
      await session.command('Input.insertText', { text: target.text })
      const read = await contents.executeJavaScript(
        readValueExpression(snapshotId, target.ref), true
      ) as { value: string | null }
      return {
        connectionId: session.connectionId,
        ref: target.ref,
        cleared: target.clear,
        ...(read.value === null ? {} : { value: read.value })
      }
    }
    throw new Error('type requires selector or ref')
  }

  async pressKey(key: string, modifiers: string[]): Promise<unknown> {
    const { session, input } = this.resolve()
    return { connectionId: session.connectionId, ...await input.pressKey(key, modifiers) }
  }

  async scroll(target: AppScrollTarget): Promise<unknown> {
    const { contents, session, input } = this.resolve()
    if (target.selector) {
      await contents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)});
        if (!el) throw new Error('No element matched selector: ' + ${JSON.stringify(target.selector)});
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      })()`, true)
      return { connectionId: session.connectionId, scrolled: 'into_view', selector: target.selector }
    }
    if (target.ref) {
      const snapshotId = this.requireSnapshot(target.ref)
      const result = await contents.executeJavaScript(
        scrollRefExpression(snapshotId, target.ref), true
      ) as { scrollX: number; scrollY: number }
      return { connectionId: session.connectionId, scrolled: 'into_view', ref: target.ref, ...result }
    }
    return { connectionId: session.connectionId, ...await input.scroll(target.ref, target.deltaX, target.deltaY) }
  }

  async waitFor(options: AppWaitOptions, signal: AbortSignal): Promise<AppWaitResult> {
    const started = Date.now()
    let last: ConditionProbe = { selectorMatched: null, textMatched: null, matches: [] }
    for (;;) {
      if (signal.aborted) throw new Error('ClosedAI app wait was aborted')
      const { contents } = this.resolve()
      last = await probeCondition(contents, options)
      if (conditionReached(last, options)) return waitResult(options, last, true, Date.now() - started)
      const elapsed = Date.now() - started
      if (elapsed >= options.timeoutMs) return waitResult(options, last, false, elapsed)
      await abortableDelay(Math.min(POLL_MS, options.timeoutMs - elapsed), signal)
    }
  }

  dispose(): void {
    this.connection?.session.dispose()
    this.connection = null
    this.snapshotId = null
  }

  private requireSnapshot(ref: string): string {
    if (!this.snapshotId || !ref.startsWith(`${this.snapshotId}:`)) {
      throw new Error('Element reference is stale or unknown; inspect the app again')
    }
    return this.snapshotId
  }

  private resolve(): Connection & { window: BrowserWindow; contents: WebContents } {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) throw new Error('The ClosedAI app window is not available')
    const contents = window.webContents
    const current = this.connection
    if (current?.session.contentsId === contents.id) return { window, contents, ...current }
    current?.session.dispose()
    this.snapshotId = null
    const session = new CdpSession(APP_TARGET_ID, contents, (closed) => {
      if (this.connection?.session === closed) this.connection = null
    })
    const page = new CdpPageController(session)
    const input = new CdpPageInput(session, page)
    this.connection = { session, page, input }
    return { window, contents, session, page, input }
  }
}

function waitResult(
  options: AppWaitOptions,
  probe: ConditionProbe,
  reached: boolean,
  elapsedMs: number
): AppWaitResult {
  return { ...options, reached, elapsedMs, ...probe }
}

function conditionReached(probe: ConditionProbe, options: AppWaitOptions): boolean {
  const expected = options.condition === 'visible'
  return [probe.selectorMatched, probe.textMatched]
    .filter((value): value is boolean => value !== null)
    .every((value) => value === expected)
}

async function probeCondition(contents: WebContents, options: AppWaitOptions): Promise<ConditionProbe> {
  const script = `(() => {
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
  return await contents.executeJavaScript(script, true) as ConditionProbe
}

function appInspectionExpression(snapshotId: string, maxElements: number): string {
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

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}
