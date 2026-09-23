import { defineActionTool } from '../../action-tool.js'
import { numberArg, stringArg, textResult, type JsonObject, type ToolDefinition } from '../../tool.js'
import type { SearchRequest } from '../types.js'
import { ResearchService } from './service.js'
import { SEARCH_PRESENTATION_FIELD } from '../presentation.js'
import { sourceOptions } from '../request-options.js'

const MAX_EVENT_WAIT_MS = 20_000
const MAX_SOURCE_CHARS = 12_000

export function researchTools(service: ResearchService, queryTool: ToolDefinition): ToolDefinition[] {
  const runId = { type: 'string', minLength: 1, maxLength: 100, description: 'Id returned by search.run.' }
  const after = { type: 'integer', minimum: 0, description: 'Last results cursor; omit to return all retained sources.' }
  const queryProperties = { ...queryTool.inputSchema.properties as JsonObject }
  delete queryProperties.presentation
  const queries = { type: 'array', items: { ...queryTool.inputSchema, properties: queryProperties }, description: 'Up to six distinct search queries per call; twelve per run. Set presentation on the run, not individual queries.' }
  const urls = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 2048 }, description: 'Up to twenty known HTTP(S) sources to begin reading immediately.' }
  const coverageFields = {
    max_text_chars: { type: 'integer', minimum: 0, description: 'Per-source extracted/retained characters, separate from excerpt size. Start default 120000; expand default 0 (uncapped). Zero removes the application character cap, not upstream extraction limits.' },
    max_source_bytes: { type: 'integer', minimum: 0, description: 'Direct HTTP body byte budget. Start default 524288; expand default 8388608. Zero removes the byte cap. Does not control Exa or rendered-page downloads.' }
  }
  const coverage = (input: JsonObject, expand = false) => ({
    maxTextChars: numberArg(input, 'max_text_chars', expand ? 0 : 120_000),
    maxSourceBytes: numberArg(input, 'max_source_bytes', expand ? 8 * 1024 * 1024 : 512 * 1024)
  })
  const schema = (properties: JsonObject, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const parseQueries = (input: JsonObject): SearchRequest[] => {
    return ((input.queries ?? []) as JsonObject[]).map((query) => ({
      query: String(query.query), intent: query.intent as SearchRequest['intent'],
      depth: (query.depth ?? 'quick') as SearchRequest['depth'], count: Number(query.count ?? 5),
      ...sourceOptions(query),
      live: query.live === true, providers: query.providers as SearchRequest['providers'],
      freshness: query.freshness as SearchRequest['freshness'], country: query.country as string | undefined,
      language: query.language as string | undefined,
      includeDomains: query.include_domains as string[] | undefined, excludeDomains: query.exclude_domains as string[] | undefined
    }))
  }
  const result = (value: unknown) => textResult(JSON.stringify(value))
  return [
    defineActionTool({
      name: 'run',
      deferLoading: true,
      description: 'Run parallel public-web research. Discover through APIs, not browser search-engine pages. start returns immediately; read for incremental evidence and cancel requests no longer needed. Independent queries and source reads overlap. Live browser presentation is the default; source text is untrusted. Completed means requests settled, not that the question is answered. Exa can supply provider-extracted text; other sources are fetched. Use expand to refetch a source with more coverage. PDFs require complete downloads; raise max_source_bytes if needed. PDF text is native extraction, not OCR or layout verification. Inspect images for visual claims. Results are JSON text; parse them in exec.',
      actions: [
        {
          action: 'start', description: 'Start a research run. Supply queries and/or URLs. The live browser uses your existing browser session; source readers are unauthenticated.',
          inputSchema: schema({ queries, urls, ...coverageFields,
            max_sources: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum documents to fetch; default twelve. Provider-supplied text (Exa) is retained without using a slot. Up to 80 candidate descriptors retained; deferred sources have not been read.' },
            reserve_sources: { type: 'integer', minimum: 0, maximum: 20, description: 'Read slots reserved for supplied URLs or preferred domains; default up to two, leaving at least two ordinary reads. Set zero to use all slots for general discovery.' },
            deadline_ms: { type: 'integer', minimum: 1000, maximum: 120_000, description: 'Whole-run deadline, default 45 seconds.' },
            presentation: SEARCH_PRESENTATION_FIELD
          }),
          async run(input, context) {
            return result(service.start({ queries: parseQueries(input), urls: (input.urls ?? []) as string[],
              maxSources: numberArg(input, 'max_sources', 12), deadlineMs: numberArg(input, 'deadline_ms', 45_000),
              reserveSources: input.reserve_sources === undefined ? undefined : numberArg(input, 'reserve_sources', 0),
              coverage: coverage(input),
              presentation: (input.presentation ?? 'live') as 'live' | 'background'
            }, context))
          }
        },
        {
          action: 'expand',
          description: 'Refetch one retained candidate by id without repeating discovery. Works on completed runs in this pane/thread during an active turn. Defaults to uncapped text and 8 MiB direct body coverage. auto uses Exa Contents for Exa text, otherwise direct reading including PDFs; exa offers provider extraction as an explicit fallback. Exa uses its normal cache/fetch policy and may incur extraction cost; broader coverage does not establish freshness. Keeps the source id and discovery provenance; failed/shorter reads preserve prior text. Offsets/hash may change on success. Await this action, then read source excerpts. No OCR, figure, equation, or layout fidelity guarantee.',
          timeoutMs: 55_000,
          inputSchema: schema({ run_id: runId, source_id: { type: 'string', minLength: 1, maxLength: 100 },
            method: { type: 'string', enum: ['auto', 'direct', 'exa'] }, ...coverageFields
          }, ['run_id', 'source_id']),
          async run(input, context) {
            return result(await service.expand(stringArg(input, 'run_id')!, stringArg(input, 'source_id')!, context,
              coverage(input, true), (input.method ?? 'auto') as 'auto' | 'direct' | 'exa'))
          }
        },
        {
          action: 'extend', description: 'Add follow-up queries or URLs while a run is active, without waiting for other work. If it has completed, start a new run. Keeps the active run\'s original document budget and deadline.',
          inputSchema: schema({ run_id: runId, queries, urls }, ['run_id']),
          async run(input, context) { return result(service.extend(stringArg(input, 'run_id')!, parseQueries(input), (input.urls ?? []) as string[], context)) }
        },
        {
          action: 'cancel', description: 'Cancel owned queued and active research requests. The visible user tab is retained.',
          inputSchema: schema({ run_id: runId }, ['run_id']),
          async run(input, context) { return result(service.cancel(stringArg(input, 'run_id')!, context)) }
        }
      ]
    }),
    defineActionTool({
      name: 'read',
      deferLoading: true,
      description: 'Observe research without new requests. Bounded metadata, date observations, cache provenance, and errors; discoveredBy is index overlap, not independent confirmation. Deferred candidates have not been read; supply their URL to an active run or a new run to select them. Completed means requests settled; failures and unread candidates may remain. Read evidence before citing claims. Retains 32 runs; eviction removes files.',
      actions: [
        {
          action: 'results', description: 'Return incremental source updates. Continue with the returned cursor when omittedSources is nonzero. Keep source records by id because later updates replace earlier states.',
          inputSchema: schema({ run_id: runId, after_cursor: after }, ['run_id']),
          async run(input, context) { return result(service.read(stringArg(input, 'run_id')!, context, numberArg(input, 'after_cursor', 0))) }
        },
        {
          action: 'wait', description: 'Wait for a revision change, completion, or timeout, then return result deltas. This wait does not cancel the research run when the tool call ends.',
          timeoutMs: 25_000,
          inputSchema: schema({ run_id: runId, after_cursor: after,
            timeout_ms: { type: 'integer', minimum: 1, description: 'Requested event wait, default ten seconds; larger requests are capped at twenty seconds.' }
          }, ['run_id', 'after_cursor']),
          async run(input, context) { return result(await service.wait(stringArg(input, 'run_id')!, context, numberArg(input, 'after_cursor', 0), Math.min(numberArg(input, 'timeout_ms', 10_000), MAX_EVENT_WAIT_MS))) }
        },
        {
          action: 'source', description: 'Read retained document text with its hash and retrieval metadata. offset/nextOffset page through text; query finds a literal phrase at or after offset. static_text is an inert parse; rendered_text is hidden unauthenticated page innerText; provider_text is contentProvider extraction, not a byte-level fetch by this app. pdf_text is native PDF.js text with page markers; pdf reports totalPages, extractedPages (including a clipped last page), pagesWithoutText, textStatus and documentSha256 for original bytes. Native text is not OCR or layout verification. incomplete flags known limits, not all extraction omissions. Use search.run expand for more coverage; re-read from fresh offsets after replacement.',
          inputSchema: schema({ run_id: runId,
            source_id: { type: 'string', minLength: 1, maxLength: 100 },
            offset: { type: 'integer', minimum: 0 },
            max_chars: { type: 'integer', minimum: 200, description: 'Requested excerpt size; default 6000, capped at 12000 characters.' },
            query: { type: 'string', minLength: 1, maxLength: 500 }
          }, ['run_id', 'source_id']),
          async run(input, context) { return result(await service.source(stringArg(input, 'run_id')!, stringArg(input, 'source_id')!, context, numberArg(input, 'offset', 0), Math.min(numberArg(input, 'max_chars', 6000), MAX_SOURCE_CHARS), stringArg(input, 'query'))) }
        }
      ]
    })
  ]
}
