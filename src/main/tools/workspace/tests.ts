import type { ToolAction } from '../action-tool.js'
import { stringArg, textResult } from '../tool.js'
import {
  cleanPath,
  fileSet,
  importersOf,
  inputSchema,
  pathField,
  siblingTests,
  testPattern
} from './query.js'

export function testsAction(root: string): ToolAction {
  return {
    action: 'tests',
    description:
      'Find same-basename tests and test files that directly import one source file. ' +
      'These are test candidates, not evidence of execution or coverage.',
    inputSchema: inputSchema({ path: pathField }, ['path']),
    async run(input) {
      const file = cleanPath(stringArg(input, 'path') ?? '')
      if (!fileSet.has(file)) throw new Error(`${JSON.stringify(file)} is not an indexed file`)
      if (testPattern.test(file)) throw new Error('`path` must name a non-test source file')
      const siblings = siblingTests(file)
      const importers = await importersOf(root, file, true)
      const candidates = [...new Set([...siblings, ...importers])].sort()
      return textResult([
        `Candidate tests for ${file}`,
        candidates.length ? candidates.map((candidate) => `  ${candidate}`).join('\n') : '  (none found)',
        '',
        'Relationship evidence only; this does not measure test execution or coverage.'
      ].join('\n'))
    }
  }
}
