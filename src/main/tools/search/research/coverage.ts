/** App defaults, not provider limits. Zero removes the corresponding application cap. */
export const DEFAULT_TEXT_CHARS = 120_000
export const DEFAULT_SOURCE_BYTES = 512 * 1024
export type SourceCoverage = { maxTextChars?: number; maxSourceBytes?: number }

export function textLimit(coverage?: SourceCoverage): number {
  return coverage?.maxTextChars ?? DEFAULT_TEXT_CHARS
}

export function boundedText(text: string, limit: number): string {
  return limit === 0 ? text : text.slice(0, limit)
}

export function validateCoverage(coverage: SourceCoverage): void {
  for (const value of [coverage.maxTextChars, coverage.maxSourceBytes]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error('Source coverage limits must be nonnegative safe integers; zero removes the cap')
    }
  }
}
