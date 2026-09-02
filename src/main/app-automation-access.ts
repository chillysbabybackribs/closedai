import type { BrowserWindow, WebContents } from 'electron'
import type { AppToolHost, AppWaitOptions, AppWaitResult } from './tools/app/host.js'
import { CdpSession } from './cdp/cdp-session.js'
import { CdpPageController } from './cdp/page-control/page-controller.js'
import { CdpPageInput } from './cdp/page-control/page-input.js'

type Connection = {
  session: CdpSession
  page: CdpPageController
  input: CdpPageInput
}

type ConditionProbe = {
  selectorMatched: boolean | null
  textMatched: boolean | null
}

const APP_TARGET_ID = 'closedai-app'
const POLL_MS = 75

/** Electron adapter for semantic model interaction with the app renderer itself. */
export class AppAutomationAccess implements AppToolHost {
  private connection: Connection | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  async inspect(maxElements: number): Promise<unknown> {
    const { window, contents, session, page } = this.resolve()
    const [inspection, documentState] = await Promise.all([
      page.inspect(maxElements),
      contents.executeJavaScript(APP_STATE_SCRIPT, true)
    ])
    return {
      window: {
        title: window.getTitle(),
        focused: window.isFocused(),
        visible: window.isVisible(),
        minimized: window.isMinimized(),
        maximized: window.isMaximized(),
        bounds: window.getBounds()
      },
      document: documentState,
      connectionId: session.connectionId,
      ...inspection
    }
  }

  async click(ref: string): Promise<unknown> {
    const { session, page } = this.resolve()
    return { connectionId: session.connectionId, ...await page.click(ref) }
  }

  async typeText(ref: string, text: string, clear: boolean): Promise<unknown> {
    const { session, input } = this.resolve()
    return { connectionId: session.connectionId, ...await input.type(ref, text, clear) }
  }

  async pressKey(key: string, modifiers: string[]): Promise<unknown> {
    const { session, input } = this.resolve()
    return { connectionId: session.connectionId, ...await input.pressKey(key, modifiers) }
  }

  async scroll(ref: string | undefined, deltaX: number, deltaY: number): Promise<unknown> {
    const { session, input } = this.resolve()
    return { connectionId: session.connectionId, ...await input.scroll(ref, deltaX, deltaY) }
  }

  async waitFor(options: AppWaitOptions, signal: AbortSignal): Promise<AppWaitResult> {
    const started = Date.now()
    let last: ConditionProbe = { selectorMatched: null, textMatched: null }
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
  }

  private resolve(): Connection & { window: BrowserWindow; contents: WebContents } {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) throw new Error('The ClosedAI app window is not available')
    const contents = window.webContents
    const current = this.connection
    if (current?.session.contentsId === contents.id) return { window, contents, ...current }
    current?.session.dispose()
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
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 &&
        Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    };
    const selectorMatched = selector
      ? Array.from(document.querySelectorAll(selector)).some(visible)
      : null;
    const visibleText = document.body ? document.body.innerText || '' : '';
    return { selectorMatched, textMatched: needle ? visibleText.includes(needle) : null };
  })()`
  return await contents.executeJavaScript(script, true) as ConditionProbe
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

const APP_STATE_SCRIPT = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 &&
      Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
  };
  const label = (element) => element.getAttribute('aria-label') || element.getAttribute('title') || '';
  const describe = (element) => ({
    tag: element.tagName.toLowerCase(),
    surface: element.getAttribute('data-ui-surface'),
    role: element.getAttribute('role'),
    label: label(element),
    source: element.getAttribute('data-ui-source'),
    stateOwner: element.getAttribute('data-ui-state-owner'),
    text: (element.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500)
  });
  const bodyText = document.body ? document.body.innerText || '' : '';
  const active = document.activeElement;
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    activeElement: active && active instanceof HTMLElement ? describe(active) : null,
    surfaces: Array.from(document.querySelectorAll('[data-ui-surface], [role="dialog"], [role="alert"], [role="status"]'))
      .filter(visible).slice(0, 100).map(describe),
    visibleText: bodyText.slice(0, 8000),
    textTruncated: bodyText.length > 8000
  };
})()`
