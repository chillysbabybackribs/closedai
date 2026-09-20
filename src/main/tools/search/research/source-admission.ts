import type { ResearchSource } from '../../../../shared/web-research.js'

export const MAX_CANDIDATES = 80
const MAX_CONCURRENT_READS = 8

/** Scheduling preferences, not credibility judgments. No network or model calls. */
export class SourceAdmission {
  readCount = 0
  active = 0
  readonly reserved: number
  private readonly origins = new Map<string, number>()

  constructor(readonly maxReads: number, reserve = Math.min(2, Math.max(0, maxReads - 2))) {
    this.reserved = Math.min(maxReads, Math.max(0, reserve))
  }

  next(sources: Iterable<ResearchSource>): ResearchSource | undefined {
    if (this.active >= MAX_CONCURRENT_READS || this.readCount >= this.maxReads) return undefined
    const available = [...sources].filter((source) => source.state === 'deferred')
    const priority = (source: ResearchSource) => source.selection === 'requested' ? 2 : source.selection === 'preferred_domain' ? 1 : 0
    available.sort((a, b) => priority(b) - priority(a)
      || (this.origins.get(new URL(a.url).origin) ?? 0) - (this.origins.get(new URL(b.url).origin) ?? 0))
    const next = available[0]
    if (!next || (!priority(next) && this.readCount >= this.maxReads - this.reserved)) return undefined
    return next
  }

  begin(source: ResearchSource): void {
    this.readCount += 1
    this.active += 1
    const origin = new URL(source.url).origin
    this.origins.set(origin, (this.origins.get(origin) ?? 0) + 1)
  }

  end(): void { this.active -= 1 }
}

export function prefersDomain(url: string, domains: Set<string>): boolean {
  const hostname = new URL(url).hostname.toLowerCase()
  return [...domains].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}
