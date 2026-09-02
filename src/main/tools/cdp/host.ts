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
}

export type CdpHostProvider = () => CdpToolHost | null

export function requireCdp(provider: CdpHostProvider): CdpToolHost {
  const host = provider()
  if (!host) throw new Error('CDP access is not available yet')
  return host
}
