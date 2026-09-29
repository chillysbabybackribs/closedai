/**
 * Gap between a capsule control and the panel it opens. Controls sit 8px inside the capsule, so
 * this clears its top edge and the panel floats above the capsule instead of overlapping it.
 */
export const CAPSULE_PANEL_OFFSET = 15

/**
 * The box a composer panel must stay inside: the chat pane, or the whole viewport inside a layer
 * that grows its viewport to fit the panel (the browser's quick chat, `data-composer-panels="viewport"`).
 */
export function composerPanelBoundary(trigger: Element | null): Element | null {
  if (trigger?.closest('[data-composer-panels="viewport"]')) return null
  return trigger?.closest('.chat-pane') ?? null
}
