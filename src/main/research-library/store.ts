import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { LibraryPaper, LibraryRefresh, LibrarySettings } from '../../shared/research-library.js'
import { writeAtomic } from '../atomic-write.js'
import { MAX_ABSTRACT, paperDigest, paperId } from './provider.js'

export const MAX_PAPERS = 500
export const MAX_DISMISSED = 2000
export const DEFAULT_SETTINGS: LibrarySettings = {
  topics: [
    'Language model agent memory and context retrieval',
    'Reliable tool use and evaluation of coding agents',
    'Efficient retrieval augmented generation'
  ],
  lookbackDays: 90,
  enabled: true
}

const settingsSchema = z.object({
  topics: z.array(z.string().trim().min(3).max(200)).min(1).max(5),
  lookbackDays: z.number().int().min(7).max(365),
  enabled: z.boolean()
}).strict()
const timestamp = z.string().datetime()
const paperSchema = z.object({
  id: z.string().refine((id) => paperId(id) === id), title: z.string().min(1).max(500),
  abstract: z.string().max(MAX_ABSTRACT), abstractTruncated: z.boolean(),
  publishedAt: timestamp, url: z.string().max(300),
  topics: z.array(z.string().max(200)).min(1).max(5), retrievedAt: timestamp,
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().refine((paper) => paper.url === `https://www.alphaxiv.org/abs/${paper.id}` &&
  paper.sha256 === paperDigest(paper.title, paper.abstract))
const refreshSchema = z.object({
  startedAt: timestamp, finishedAt: timestamp,
  state: z.enum(['completed', 'partial', 'failed', 'cancelled', 'timed_out']),
  received: z.number().int().nonnegative(), added: z.number().int().nonnegative(),
  errors: z.array(z.object({ topic: z.string().max(200), message: z.string().max(300) }).strict()).max(5)
}).strict()
const stateSchema = z.object({
  version: z.literal(1), settings: settingsSchema,
  papers: z.array(paperSchema).max(MAX_PAPERS),
  dismissed: z.array(z.string().refine((id) => paperId(id) === id)).max(MAX_DISMISSED),
  lastRefresh: refreshSchema.nullable()
}).strict()

export type LibraryState = {
  version: 1; settings: LibrarySettings; papers: LibraryPaper[]
  dismissed: string[]; lastRefresh: LibraryRefresh | null
}

export function validateSettings(input: unknown): LibrarySettings {
  const parsed = settingsSchema.parse(input)
  const seen = new Set<string>()
  return { ...parsed, topics: parsed.topics.filter((topic) => {
    const key = topic.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }) }
}

/** Small bounded public index. Validate before use; never silently replace a damaged file. */
export class LibraryStore {
  constructor(private readonly path: string) {}

  async load(): Promise<LibraryState> {
    try {
      if ((await stat(this.path)).size > 24 * 1024 * 1024) throw new Error('Research library exceeds its storage limit')
      return stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {
        version: 1, settings: structuredClone(DEFAULT_SETTINGS), papers: [], dismissed: [], lastRefresh: null
      }
      throw new Error('Research library could not be read. The existing file has been preserved.', { cause: error })
    }
  }

  async save(state: LibraryState): Promise<void> {
    await writeAtomic(this.path, JSON.stringify(stateSchema.parse(state)))
  }
}
