import type { LocalElement } from './cdp/page-control/runtime.js'

const ELEMENT_OUTPUT_BUDGET = 8_000

export type AppInspectionElement = {
  ref: string
  tag: string
  role: string
  name: string
  text?: string
  state: Record<string, boolean | string>
  bounds: { x: number; y: number; width: number; height: number }
  hitTestable: boolean
}

/** Keep app inspection useful before the generic result limiter has to collapse its arrays. */
export function compactAppInspectionElements(
  source: LocalElement[],
  budget = ELEMENT_OUTPUT_BUDGET
): { elements: AppInspectionElement[]; omitted: number } {
  const elements: AppInspectionElement[] = []
  let used = 2
  for (const value of source) {
    const element = compactElement(value)
    const size = JSON.stringify(element).length + (elements.length > 0 ? 1 : 0)
    if (used + size > budget) break
    elements.push(element)
    used += size
  }
  return { elements, omitted: source.length - elements.length }
}

function compactElement(value: LocalElement): AppInspectionElement {
  const name = value.name.slice(0, 240)
  const text = value.text?.replace(/\s+/g, ' ').trim().slice(0, 240)
  return {
    ref: value.ref,
    tag: value.tag,
    role: value.role,
    name,
    ...(text && text !== name ? { text } : {}),
    state: {
      disabled: value.disabled,
      ...(value.checked === undefined ? {} : { checked: value.checked }),
      ...(value.value === undefined ? {} : { value: value.value.slice(0, 240) })
    },
    bounds: {
      x: rounded(value.bounds.x),
      y: rounded(value.bounds.y),
      width: rounded(value.bounds.width),
      height: rounded(value.bounds.height)
    },
    hitTestable: value.hitTestable
  }
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}
