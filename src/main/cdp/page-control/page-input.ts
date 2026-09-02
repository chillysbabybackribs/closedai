import type { CdpCommandTarget } from './page-controller.js'
import type { AgentPageClick, ViewportPoint } from './types.js'
import { prepareTypeExpression, readValueExpression, scrollRefExpression } from './runtime.js'
import { numberOf, recordOf } from './protocol-values.js'

// High-level keyboard and scroll input over CDP. One `type` call replaces the hundreds of
// raw Input.dispatchKeyEvent commands a model otherwise issues per form field, and every
// event sequence it sends is a real trusted CDP input, not synthetic DOM events.

/** The slice of CdpPageController that input needs: focus clicks and ref-scoped evaluation. */
export type PageInputPage = {
  click(ref: string): Promise<AgentPageClick>
  evaluateOnRef<T>(ref: string, build: (snapshotId: string, ref: string) => string, awaitPromise?: boolean): Promise<T>
}

export type AgentPageTypeResult = {
  ref: string
  point: ViewportPoint
  coordinateSpace: 'main_viewport_css'
  cleared: boolean
  /** The element's value after typing (truncated), when it could be read back. */
  value?: string
}

export type AgentPageKeyResult = {
  key: string
  code: string
  modifiers: string[]
}

export type AgentPageScrollResult =
  | { scrolled: 'into_view'; ref: string; scrollX: number; scrollY: number }
  | { scrolled: 'wheel'; point: ViewportPoint; deltaX: number; deltaY: number }

export const KEY_MODIFIERS = ['alt', 'ctrl', 'meta', 'shift'] as const
export type KeyModifier = (typeof KEY_MODIFIERS)[number]

type KeyDefinition = { key: string; code: string; keyCode: number; text?: string }

const NAMED_KEYS: Record<string, KeyDefinition> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 }
}

const MODIFIER_BITS: Record<KeyModifier, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

export class CdpPageInput {
  constructor(
    private readonly target: CdpCommandTarget,
    private readonly page: PageInputPage
  ) {}

  /** Focus a ref with a real click, optionally select its contents, and insert text in one call. */
  async type(ref: string, text: string, clear: boolean): Promise<AgentPageTypeResult> {
    const click = await this.page.click(ref)
    await this.page.evaluateOnRef<boolean>(ref, (snapshotId, target) => prepareTypeExpression(snapshotId, target, clear))
    await this.target.command('Input.insertText', { text })
    const after = await this.page.evaluateOnRef<{ value: string | null }>(ref, readValueExpression)
    return {
      ref,
      point: click.point,
      coordinateSpace: 'main_viewport_css',
      cleared: clear,
      ...(after.value === null ? {} : { value: after.value })
    }
  }

  /** Press one key (a named key or a single character), with optional modifiers, as keyDown+keyUp. */
  async pressKey(key: string, modifiers: string[]): Promise<AgentPageKeyResult> {
    const definition = resolveKey(key)
    const bits = modifierBits(modifiers)
    // Shortcut chords (ctrl/meta) must not also insert the character as text.
    const text = bits & (MODIFIER_BITS.ctrl | MODIFIER_BITS.meta) ? undefined : definition.text
    const shared = {
      modifiers: bits,
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.keyCode,
      nativeVirtualKeyCode: definition.keyCode
    }
    await this.target.command('Input.dispatchKeyEvent', {
      ...shared,
      type: text ? 'keyDown' : 'rawKeyDown',
      ...(text ? { text, unmodifiedText: text } : {})
    })
    await this.target.command('Input.dispatchKeyEvent', { ...shared, type: 'keyUp' })
    return { key: definition.key, code: definition.code, modifiers: [...modifiers].sort() }
  }

  /** Scroll a ref into view, or wheel-scroll the main viewport by CSS-pixel deltas. */
  async scroll(ref: string | undefined, deltaX: number, deltaY: number): Promise<AgentPageScrollResult> {
    if (ref) {
      const offsets = await this.page.evaluateOnRef<{ scrollX: number; scrollY: number }>(ref, scrollRefExpression, true)
      return { scrolled: 'into_view', ref, ...offsets }
    }
    if (deltaX === 0 && deltaY === 0) throw new Error('Pass a ref to scroll to, or a non-zero delta_x/delta_y')
    const point = await this.viewportCenter()
    await this.target.command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      button: 'none',
      buttons: 0,
      deltaX,
      deltaY
    })
    return { scrolled: 'wheel', point, deltaX, deltaY }
  }

  private async viewportCenter(): Promise<ViewportPoint> {
    const response = recordOf(await this.target.command('Page.getLayoutMetrics'))
    const viewport = recordOf(response?.cssVisualViewport) ?? recordOf(response?.visualViewport) ??
      recordOf(response?.cssLayoutViewport) ?? recordOf(response?.layoutViewport)
    const width = numberOf(viewport?.clientWidth)
    const height = numberOf(viewport?.clientHeight)
    if (width === null || height === null || width <= 0 || height <= 0) {
      throw new Error('CDP did not report a usable viewport to scroll in')
    }
    return { x: width / 2, y: height / 2 }
  }
}

function resolveKey(key: string): KeyDefinition {
  const named = NAMED_KEYS[key.toLowerCase()]
  if (named) return named
  if ([...key].length === 1) {
    const upper = key.toUpperCase()
    const isLetter = /^[a-z]$/i.test(key)
    const isDigit = /^[0-9]$/.test(key)
    return {
      key,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${key}` : '',
      keyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
      text: key
    }
  }
  throw new Error(
    `Unsupported key "${key}". Use a single character or one of: ${Object.values(NAMED_KEYS).map((entry) => entry.key).join(', ')}`
  )
}

function modifierBits(modifiers: string[]): number {
  let bits = 0
  for (const modifier of modifiers) {
    const bit = MODIFIER_BITS[modifier as KeyModifier]
    if (bit === undefined) throw new Error(`Unknown modifier "${modifier}"; use alt, ctrl, meta, or shift`)
    bits |= bit
  }
  return bits
}
