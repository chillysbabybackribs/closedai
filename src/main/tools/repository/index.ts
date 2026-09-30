import { jsonResult, objectSchema } from '../json-result.js'
import { defineTool, usageResult, type ToolContext, type ToolNamespace } from '../tool.js'
import { locate, readRange, search, type ReadRequest, type SearchRequest } from './retrieval.js'

export type RepositoryHost = { root: (context: ToolContext) => string }
const path = { type: 'string', minLength: 1, maxLength: 2048, description: 'Path relative to the calling chat project; no paths outside that project.' }

/** Registration is opt-in at app startup. No native tools or provider instructions are replaced. */
export function repositoryTools(host: RepositoryHost): ToolNamespace {
  return {
    name: 'repository',
    description: 'Read-only source retrieval in the calling chat project. Locate likely code, batch exact searches, and read ranges concurrently. Native editing and command execution remain available.',
    tools: [
      defineTool({
        name: 'locate', deferLoading: true,
        description: 'Find likely source files from a behavior description, feature, or symbol. Live lexical ranking over filenames and source text (not semantic embeddings). Returns ranked paths, matching evidence, numbered excerpts, and content hashes. Results are candidates; follow callers before editing.',
        inputSchema: objectSchema({ query: { type: 'string', minLength: 1, maxLength: 1000 } }, ['query']),
        run: async (input, context) => jsonResult(await locate(host.root(context), input.query as string, context.signal))
      }),
      defineTool({
        name: 'search_many', deferLoading: true,
        description: 'Run up to four independent rg searches concurrently. Literal case-insensitive search by default; regex opt-in. Honors ignore rules, skips hidden files, does not follow symlinks. Results have paths, line numbers and bounded excerpts; narrow scope when truncated. Never writes or runs shell text.',
        inputSchema: objectSchema({ queries: { type: 'array', minItems: 1, maxItems: 4, items: objectSchema({
          pattern: { type: 'string', minLength: 1, maxLength: 500 }, path, regex: { type: 'boolean' }
        }, ['pattern']) } }, ['queries']),
        run: async (input, context) => {
          if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > 4) return usageResult('queries must contain 1–4 searches')
          const root = host.root(context)
          return jsonResult(await Promise.all((input.queries as SearchRequest[]).map(async query => {
            try { return { query, ...await search(root, query, context.signal) } }
            catch (error) { return { query, error: String(error) } }
          })))
        }
      }),
      defineTool({
        name: 'read_many', deferLoading: true,
        description: 'Read up to four text file ranges concurrently. Returns numbered lines, SHA-256 of the file, and a continuation line when limited. Defaults to 80 lines per file. Maximum file size 1 MB. Use native editing tools after verifying current content.',
        inputSchema: objectSchema({ files: { type: 'array', minItems: 1, maxItems: 4, items: objectSchema({
          path, from_line: { type: 'integer', minimum: 1 }, to_line: { type: 'integer', minimum: 1 }
        }, ['path']) } }, ['files']),
        run: async (input, context) => {
          if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 4) return usageResult('files must contain 1–4 ranges')
          const root = host.root(context)
          return jsonResult(await Promise.all((input.files as ReadRequest[]).map(async file => {
            try { return await readRange(root, file, context.signal) }
            catch (error) { return { path: file.path, error: String(error) } }
          })))
        }
      })
    ]
  }
}
