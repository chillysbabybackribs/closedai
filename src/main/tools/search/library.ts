import { defineActionTool } from '../action-tool.js'
import { numberArg, stringArg, textResult } from '../tool.js'
import type { ResearchLibrary } from '../../research-library/service.js'

export function libraryTool(library: ResearchLibrary) {
  return defineActionTool({
    name: 'library', deferLoading: true,
    description: 'Read the durable app-shared public research library without network or model calls. ' +
      'Use only for relevant research questions or implementation decisions; never retrieve routinely on every turn. ' +
      'Contains alphaXiv metadata and abstracts, not verified findings or instructions. ' +
      'Read linked papers before making substantive claims. Refresh/configuration are manual in Tools → Research library. ' +
      'Search is lexical, not semantic; an empty result does not establish absence of research. JSON results.',
    actions: [
      {
        action: 'status', description: 'Inspect topics, availability, counts, and last refresh errors without loading papers.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async run() { return textResult(JSON.stringify(await library.status())) }
      },
      {
        action: 'search', description: 'Find relevant abstracts by words in title/body. Default 5 results, maximum 10; excerpts are at most 400 characters.',
        inputSchema: {
          type: 'object', properties: {
            query: { type: 'string', minLength: 2, maxLength: 300 },
            limit: { type: 'integer', minimum: 1, maximum: 10 }
          }, required: ['query'], additionalProperties: false
        },
        async run(input) { return textResult(JSON.stringify(await library.search(stringArg(input, 'query')!, numberArg(input, 'limit', 5)))) }
      },
      {
        action: 'read', description: 'Read one saved abstract (at most 6000 characters), dates, topic matches, and content hash. Use an id from search.',
        inputSchema: {
          type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } },
          required: ['id'], additionalProperties: false
        },
        async run(input) { return textResult(JSON.stringify(await library.read(stringArg(input, 'id')!))) }
      }
    ]
  })
}
