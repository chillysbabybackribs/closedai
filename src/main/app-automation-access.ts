import type { BrowserWindow, WebContents } from 'electron'
import type {
  AppClickTarget,
  AppConditionProbe,
  AppControlFilter,
  AppControlsResult,
  AppScrollTarget,
  AppTypeTarget,
  AppUiHost,
  AppUiState,
  AppUiTarget,
  AppWaitOptions,
  AppWaitResult
} from './tools/app/host.js'
import { dispatchAppClick } from './app-automation-input.js'
import {
  conditionProbeExpression,
  controlsExpression,
  targetClickExpression,
  targetScrollExpression,
  targetSelector,
  targetTypeExpression,
  targetValueExpression,
  uiStateExpression,
  type AppPreparedClick
} from './app-automation-dom.js'
import { CdpSession } from './cdp/cdp-session.js'
import { CdpPageController } from './cdp/page-control/page-controller.js'
import { CdpPageInput } from './cdp/page-control/page-input.js'
import type { AgentPageClick } from './cdp/page-control/types.js'

type Connection = {
  session: CdpSession
  page: CdpPageController
  input: CdpPageInput
}

const APP_TARGET_ID = 'closedai-app'
const POLL_MS = 75

/** Electron adapter for control-level model interaction with the app renderer itself. */
export class AppAutomationAccess implements AppUiHost {
  private connection: Connection | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  async controls(filter: AppControlFilter): Promise<AppControlsResult> {
    const { contents } = this.resolve()
    return await contents.executeJavaScript(controlsExpression(filter), true) as AppControlsResult
  }

  async uiState(): Promise<AppUiState> {
    const { contents } = this.resolve()
    return await contents.executeJavaScript(uiStateExpression(), true) as AppUiState
  }

  async click(target: AppClickTarget): Promise<unknown> {
    const { window, contents, page } = this.resolve()
    if (typeof target.x === 'number' && typeof target.y === 'number') {
      return await this.clickAt(window, contents, page, { x: target.x, y: target.y })
    }
    const prepared = await contents.executeJavaScript(targetClickExpression(target), true) as AppPreparedClick
    return { ...describeTarget(target), ...await this.clickAt(window, contents, page, prepared.point) }
  }

  async typeText(target: AppTypeTarget): Promise<unknown> {
    const { window, contents, session, page } = this.resolve()
    const prepared = await contents.executeJavaScript(targetClickExpression(target), true) as AppPreparedClick
    await this.clickAt(window, contents, page, prepared.point)
    await contents.executeJavaScript(targetTypeExpression(target, target.clear), true)
    await session.command('Input.insertText', { text: target.text })
    const read = await contents.executeJavaScript(targetValueExpression(target), true) as { value: string | null }
    return {
      ...describeTarget(target),
      cleared: target.clear,
      ...(read.value === null ? {} : { value: read.value })
    }
  }

  async pressKey(key: string, modifiers: string[]): Promise<unknown> {
    const { input } = this.resolve()
    return await input.pressKey(key, modifiers)
  }

  async scroll(target: AppScrollTarget): Promise<unknown> {
    const { contents, input } = this.resolve()
    if (target.control || target.selector) {
      return await contents.executeJavaScript(targetScrollExpression(target), true)
    }
    return await input.scroll(undefined, target.deltaX, target.deltaY)
  }

  async waitFor(options: AppWaitOptions, signal: AbortSignal): Promise<AppWaitResult> {
    const started = Date.now()
    let last: AppConditionProbe = { targetVisible: null, targetEnabled: null, textMatched: null }
    for (;;) {
      if (signal.aborted) throw new Error('ClosedAI app wait was aborted')
      const { contents } = this.resolve()
      last = await contents.executeJavaScript(conditionProbeExpression(options), true) as AppConditionProbe
      if (conditionReached(last, options)) return { ...options, ...last, reached: true, elapsedMs: Date.now() - started }
      const elapsed = Date.now() - started
      if (elapsed >= options.timeoutMs) return { ...options, ...last, reached: false, elapsedMs: elapsed }
      await abortableDelay(Math.min(POLL_MS, options.timeoutMs - elapsed), signal)
    }
  }

  dispose(): void {
    this.connection?.session.dispose()
    this.connection = null
  }

  private async clickAt(
    window: BrowserWindow,
    contents: WebContents,
    page: CdpPageController,
    point: { x: number; y: number }
  ): Promise<AgentPageClick> {
    const result = await page.inspectPoint(point)
    dispatchAppClick(window, contents, point)
    return result
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

function describeTarget(target: AppUiTarget): Record<string, string> {
  return {
    ...(target.control ? { control: target.control } : {}),
    ...(target.item ? { item: target.item } : {}),
    ...(target.match ? { match: target.match } : {}),
    ...(target.selector ? { selector: target.selector } : {})
  }
}

export function conditionReached(probe: AppConditionProbe, options: AppWaitOptions): boolean {
  const hasTarget = targetSelector(options) !== ''
  const visible = probe.targetVisible ?? 0
  const enabled = probe.targetEnabled ?? 0
  switch (options.condition) {
    case 'visible':
      return (!hasTarget || visible > 0) && (probe.textMatched === null || probe.textMatched)
    case 'hidden':
      return (!hasTarget || visible === 0) && (probe.textMatched === null || !probe.textMatched)
    case 'enabled':
      return hasTarget && enabled > 0
    case 'disabled':
      return hasTarget && visible > 0 && enabled === 0
  }
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
