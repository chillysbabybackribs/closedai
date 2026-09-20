import type { SourceDate } from '../../../../shared/web-research.js'

const META_DATES: Record<string, SourceDate['kind']> = {
  'article:published_time': 'published', 'citation_publication_date': 'published',
  'dc.date.issued': 'published', 'dcterms.issued': 'published', 'datepublished': 'published',
  'article:modified_time': 'modified', 'og:updated_time': 'modified',
  'dcterms.modified': 'modified', 'datemodified': 'modified'
}

/** Preserve the publisher's assertion and its origin; do not infer freshness from crawl time. */
export function metaDate(attrs: Array<{ name: string; value: string }>): SourceDate | null {
  const attr = (name: string) => attrs.find((item) => item.name === name)?.value
  const field = (attr('property') ?? attr('name') ?? attr('itemprop') ?? '').toLowerCase()
  const value = attr('content')?.trim()
  const kind = META_DATES[field]
  return kind && value ? { kind, value: value.slice(0, 120), source: `html:${field}` } : null
}

export function mergeDates(...groups: Array<SourceDate[] | undefined>): SourceDate[] {
  const entries = new Map<string, SourceDate>()
  for (const date of groups.flatMap((group) => group ?? [])) {
    const bounded = { kind: date.kind, value: date.value.slice(0, 120), source: date.source.slice(0, 100) }
    entries.set(JSON.stringify(bounded), bounded)
  }
  return [...entries.values()].slice(0, 12)
}
