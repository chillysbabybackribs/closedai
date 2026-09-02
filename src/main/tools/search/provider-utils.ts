import type { SearchProvider, SearchResult } from './types.js'
import type { SearchKeyReader } from './keyring.js'

export type ProviderDeps = {
  fetch: typeof fetch
  readKey: SearchKeyReader
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : []
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function compactText(...values: unknown[]): string {
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map(text).filter(Boolean).join('\n').trim()
}

export function result(
  provider: SearchProvider,
  item: Record<string, unknown>,
  fields: { url: string[]; title: string[]; snippet: string[]; age?: string[]; score?: string[] }
): SearchResult | null {
  const first = (names: string[]) => names.map((name) => item[name]).find((value) => typeof value === 'string')
  const url = text(first(fields.url))
  if (!url) return null
  const rawScore = fields.score?.map((name) => item[name]).find((value) => typeof value === 'number')
  return {
    provider,
    url,
    title: text(first(fields.title)) || url,
    snippet: compactText(...fields.snippet.map((name) => item[name])),
    ...(fields.age && first(fields.age) ? { age: text(first(fields.age)) } : {}),
    ...(typeof rawScore === 'number' ? { score: rawScore } : {})
  }
}

export async function checkedJson(response: Response, provider: SearchProvider): Promise<unknown> {
  if (response.ok) return response.json()
  const detail = (await response.text().catch(() => '')).slice(0, 300).trim()
  throw new Error(`${provider} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
}

export function freshnessCode(value: string | undefined): string | undefined {
  return value ? ({ day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' } as Record<string, string>)[value] : undefined
}
