import type { ToolAction } from '../action-tool.js'
import { stringArg, textResult } from '../tool.js'
import {
  cleanPath,
  fileSet,
  importersOf,
  importsOf,
  inputSchema,
  pathField,
  section,
  siblingTests
} from './query.js'

export function relatedAction(root: string): ToolAction {
  return {
    action: 'related',
    description:
      'For one indexed file, show its direct relative imports, direct importers, and same-basename tests. ' +
      'Package imports and transitive relationships are intentionally omitted.',
    inputSchema: inputSchema({ path: pathField }, ['path']),
    async run(input) {
      const file = cleanPath(stringArg(input, 'path') ?? '')
      if (!fileSet.has(file)) throw new Error(`${JSON.stringify(file)} is not an indexed file`)
      const [imports, importers] = await Promise.all([importsOf(root, file), importersOf(root, file)])
      return textResult([
        `Related files for ${file}`,
        section('Direct relative imports', imports),
        section('Direct importers', importers),
        section('Same-basename tests', siblingTests(file))
      ].join('\n\n'))
    }
  }
}
