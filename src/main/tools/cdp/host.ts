export type CdpEventResult = {
  tab: unknown
  connectionId: string
  oldestCursor: number
  nextCursor: number
  missedEvents: boolean
  events: unknown[]
}

export type CdpToolHost = {
  capabilities(tabId?: string): Promise<unknown>
  targets(tabId?: string): Promise<unknown>
  command(
    tabId: string | undefined,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown>
  events(tabId: string | undefined, afterCursor: number, limit: number, methodPrefix?: string): CdpEventResult
  inspectPage(tabId: string | undefined, maxElements: number): Promise<unknown>
  clickElement(tabId: string | undefined, ref: string): Promise<unknown>
  clickAt(tabId: string | undefined, x: number, y: number): Promise<unknown>
  typeText(tabId: string | undefined, ref: string, text: string, clear: boolean): Promise<unknown>
  pressKey(tabId: string | undefined, key: string, modifiers: string[]): Promise<unknown>
  scrollPage(tabId: string | undefined, ref: string | undefined, deltaX: number, deltaY: number): Promise<unknown>
}

export type CdpHostProvider = () => CdpToolHost | null

export function requireCdp(provider: CdpHostProvider): CdpToolHost {
  const host = provider()
  if (!host) throw new Error('CDP access is not available yet')
  return host
}
