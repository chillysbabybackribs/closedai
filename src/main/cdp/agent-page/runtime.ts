type LocalPoint = { x: number; y: number }
type LocalBounds = LocalPoint & { width: number; height: number }

export type LocalElement = {
  ref: string
  frameId: string
  tag: string
  role: string
  name: string
  bounds: LocalBounds
  center: LocalPoint
  quad: number[]
  quadSource: 'box_quad' | 'client_rect'
  visible: boolean
  hitTestable: boolean
  disabled: boolean
  checked?: boolean
  value?: string
}

export type LocalInspection = {
  viewport: { width: number; height: number; deviceScaleFactor: number; scrollX: number; scrollY: number }
  elements: LocalElement[]
  candidateCount: number
}

export type PreparedClick = {
  point: LocalPoint
  viewport: { width: number; height: number }
}

const WORLD_STATE = '__closedaiAgentPageV1'

export const FRAME_OWNER_QUAD_FUNCTION = `function () {
  const getQuads = this.getBoxQuads
  const box = typeof getQuads === 'function' ? getQuads.call(this, { box: 'content' })[0] : null
  if (box) return [box.p1.x, box.p1.y, box.p2.x, box.p2.y, box.p3.x, box.p3.y, box.p4.x, box.p4.y]
  const rect = this.getBoundingClientRect()
  const style = getComputedStyle(this)
  const scaleX = this.offsetWidth > 0 ? rect.width / this.offsetWidth : 1
  const scaleY = this.offsetHeight > 0 ? rect.height / this.offsetHeight : 1
  const left = rect.left + (parseFloat(style.borderLeftWidth) || 0) * scaleX
  const top = rect.top + (parseFloat(style.borderTopWidth) || 0) * scaleY
  const width = this.clientWidth * scaleX
  const height = this.clientHeight * scaleY
  return [left, top, left + width, top, left + width, top + height, left, top + height]
}`

export const SCROLL_FRAME_OWNER_FUNCTION = `async function () {
  this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return true
}`

export function inspectionExpression(snapshotId: string, frameId: string, maxElements: number): string {
  return `(${inspectFrame.toString()})(${JSON.stringify(snapshotId)},${JSON.stringify(frameId)},${maxElements},${JSON.stringify(WORLD_STATE)})`
}

export function prepareClickExpression(snapshotId: string, ref: string): string {
  return `(${prepareClick.toString()})(${JSON.stringify(snapshotId)},${JSON.stringify(ref)},${JSON.stringify(WORLD_STATE)})`
}

function inspectFrame(snapshotId: string, frameId: string, maxElements: number, stateKey: string): LocalInspection {
  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role]', '[tabindex]', '[contenteditable="true"]', '[onclick]',
    'audio[controls]', 'video[controls]'
  ].join(',')
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
  const registry = new Map<string, HTMLElement>()
  const elements: LocalElement[] = []

  for (const element of candidates) {
    if (elements.length >= maxElements) break
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const rect = visibleRect(element)
    if (!rect) continue
    const ref = `${snapshotId}:${frameId}:e${elements.length + 1}`
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const hit = document.elementFromPoint(center.x, center.y)
    const box = element as HTMLElement & { getBoxQuads?: () => Array<{ p1: LocalPoint; p2: LocalPoint; p3: LocalPoint; p4: LocalPoint }> }
    const boxQuad = box.getBoxQuads?.()[0]
    const quad = boxQuad
      ? [boxQuad.p1.x, boxQuad.p1.y, boxQuad.p2.x, boxQuad.p2.y, boxQuad.p3.x, boxQuad.p3.y, boxQuad.p4.x, boxQuad.p4.y]
      : [rect.left, rect.top, rect.right, rect.top, rect.right, rect.bottom, rect.left, rect.bottom]
    registry.set(ref, element)
    elements.push({
      ref,
      frameId,
      tag: element.tagName.toLowerCase(),
      role: roleOf(element),
      name: nameOf(element).slice(0, 500),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      center,
      quad,
      quadSource: boxQuad ? 'box_quad' : 'client_rect',
      visible: true,
      hitTestable: hit !== null && (hit === element || element.contains(hit)),
      disabled: 'disabled' in element && Boolean((element as HTMLButtonElement).disabled),
      ...checkedOf(element),
      ...valueOf(element)
    })
  }

  Object.defineProperty(globalThis, stateKey, {
    value: { snapshotId, registry }, configurable: true, writable: true
  })
  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    elements,
    candidateCount: candidates.length
  }

  function visibleRect(element: HTMLElement): DOMRect | null {
    const rects = Array.from(element.getClientRects())
    let best: DOMRect | null = null
    let bestArea = 0
    for (const rect of rects) {
      const left = Math.max(0, rect.left)
      const top = Math.max(0, rect.top)
      const right = Math.min(window.innerWidth, rect.right)
      const bottom = Math.min(window.innerHeight, rect.bottom)
      const area = Math.max(0, right - left) * Math.max(0, bottom - top)
      if (area > bestArea) {
        bestArea = area
        best = DOMRect.fromRect({ x: left, y: top, width: right - left, height: bottom - top })
      }
    }
    return best
  }

  function nameOf(element: HTMLElement): string {
    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledText = labelledBy?.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim()
    if (labelledText) return labelledText
    const aria = element.getAttribute('aria-label')?.trim()
    if (aria) return aria
    if (element instanceof HTMLInputElement && element.labels?.length) {
      const labels = Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(' ')
      if (labels) return labels
    }
    const alt = element.getAttribute('alt')?.trim()
    if (alt) return alt
    const placeholder = element.getAttribute('placeholder')?.trim()
    if (placeholder) return placeholder
    const title = element.getAttribute('title')?.trim()
    if (title) return title
    return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function roleOf(element: HTMLElement): string {
    const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0]
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'summary') return 'button'
    if (tag === 'input') {
      const type = (element as HTMLInputElement).type
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'submit' || type === 'reset' || type === 'button') return 'button'
      return 'textbox'
    }
    return tag
  }

  function checkedOf(element: HTMLElement): { checked?: boolean } {
    return element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
      ? { checked: element.checked }
      : {}
  }

  function valueOf(element: HTMLElement): { value?: string } {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return { value: element.value.slice(0, 500) }
    }
    return {}
  }
}

async function prepareClick(snapshotId: string, ref: string, stateKey: string): Promise<PreparedClick> {
  const state = (globalThis as typeof globalThis & {
    [key: string]: { snapshotId: string; registry: Map<string, HTMLElement> } | undefined
  })[stateKey]
  if (!state || state.snapshotId !== snapshotId) throw new Error('Element reference is stale; inspect the page again')
  const element = state.registry.get(ref)
  if (!element?.isConnected) throw new Error('Element reference is detached; inspect the page again')
  if ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) throw new Error('Element is disabled')
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const rects = Array.from(element.getClientRects())
  let point: LocalPoint | null = null
  let area = 0
  for (const rect of rects) {
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
  if (!hit || (hit !== element && !element.contains(hit))) throw new Error('Element is covered at its clickable center')
  return { point, viewport: { width: window.innerWidth, height: window.innerHeight } }
}
