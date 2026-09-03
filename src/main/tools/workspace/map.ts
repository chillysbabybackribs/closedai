import type { ToolAction } from '../action-tool.js'
import { booleanArg, numberArg, stringArg, textResult } from '../tool.js'
import {
  cleanPath,
  fileSet,
  indexedFiles,
  inputSchema,
  maxResultsField,
  pathField,
  siblingTests,
  testPattern
} from './query.js'

export const mapAction: ToolAction = {
  action: 'map',
  description:
    'List a bounded slice of the generated repository index; path defaults to src. Tests are ' +
    'omitted by default; "[sibling test]" means only that a same-basename test file exists.',
  inputSchema: inputSchema({
    path: pathField,
    depth: { type: 'integer', minimum: 0, maximum: 5, description: 'Directory levels below the requested path; default 2.' },
    include_tests: { type: 'boolean', description: 'Include test files; default false.' },
    max_results: maxResultsField
  }),
  async run(input) {
    const scope = cleanPath(stringArg(input, 'path', 'src') ?? 'src')
    const depth = numberArg(input, 'depth', 2)
    const includeTests = booleanArg(input, 'include_tests', false)
    const maxResults = numberArg(input, 'max_results', 80)
    const prefix = scope ? `${scope}/` : ''
    const candidates = fileSet.has(scope)
      ? [scope]
      : indexedFiles.filter((file) => file.startsWith(prefix) && file.slice(prefix.length).split('/').length - 1 <= depth)
    const visible = candidates.filter((file) => includeTests || !testPattern.test(file))
    if (visible.length === 0) throw new Error(`no indexed files match ${JSON.stringify(scope || '.')}`)
    const shown = visible.slice(0, maxResults)
    const lines = shown.map((file) => `${file}${siblingTests(file).length ? ' [sibling test]' : ''}`)
    const omitted = visible.length - shown.length
    const header = `Workspace map: ${scope || '.'} (depth ${depth}; ${includeTests ? 'tests included' : 'tests omitted'})`
    const footer = omitted > 0 ? `\n[${omitted} more files omitted; narrow path or raise max_results]` : ''
    return textResult(`${header}\n\n${lines.join('\n')}${footer}`)
  }
}
