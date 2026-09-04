import type { ToolAction } from '../action-tool.js'
import { numberArg, stringArg, textResult } from '../tool.js'
import { cleanPath, fileSet, inputSchema, maxResultsField, pathField, siblingTests } from './query.js'
import { factsFor, scanWorkspace, type FileFacts } from './scan.js'

// Reading a whole file to learn its shape is the most common avoidable cost in a navigation
// turn. An outline answers "what is in here and where" in a dozen lines, and for a component
// it also names the stylesheets that define the classes it renders — the pair that has to be
// edited together and is otherwise found by a second search.

const LIST_LIMIT = 60

export function outlineAction(root: string): ToolAction {
  return {
    action: 'outline',
    description:
      'Summarise one file without reading it: exported symbols with the line span each occupies, ' +
      'the `data-ui` control ids it renders, and the CSS classes it defines or references. For a ' +
      'component the stylesheets defining its classes are resolved too. Then read exactly the span ' +
      'of the symbol you need to change.',
    inputSchema: inputSchema({
      path: pathField,
      max_results: maxResultsField
    }, ['path']),
    async run(input) {
      const file = cleanPath(stringArg(input, 'path') ?? '')
      if (!fileSet.has(file)) throw new Error(`${JSON.stringify(file)} is not an indexed file`)
      const limit = numberArg(input, 'max_results', LIST_LIMIT)
      const facts = await factsFor(root, file)
      if (!facts) throw new Error(`${JSON.stringify(file)} could not be read`)

      const sections = [
        list('Exported symbols (line span)', facts.exports.map((symbol) => `${symbol.end > symbol.line ? `${symbol.line}-${symbol.end}` : symbol.line}: ${symbol.kind} ${symbol.name}`), limit),
        list('Control ids (data-ui)', facts.controls.map((control) => `${control.line}: ${control.name}`), limit),
        ...(facts.styleDefs.length
          ? [list('Classes defined here', facts.styleDefs.map((style) => `${style.line}: .${style.name}`), limit)]
          : []),
        ...(facts.styleRefs.length
          ? [list('Classes referenced', await styleOwners(root, facts), limit)]
          : []),
        list('Same-basename tests', siblingTests(file), limit)
      ]
      return textResult([`Outline of ${file} (${facts.lines.length} lines)`, ...sections].join('\n\n'))
    }
  }
}

/** Each referenced class paired with the stylesheet that defines it, when one does. */
async function styleOwners(root: string, facts: FileFacts): Promise<string[]> {
  const scanned = await scanWorkspace(root)
  const owners = new Map<string, string>()
  for (const candidate of scanned) {
    for (const style of candidate.styleDefs) {
      if (!owners.has(style.name)) owners.set(style.name, `${candidate.file}:${style.line}`)
    }
  }
  return facts.styleRefs.map((name) => {
    const owner = owners.get(name)
    return owner ? `.${name} -> ${owner}` : `.${name} (no stylesheet rule; utility or dynamic)`
  })
}

function list(title: string, entries: readonly string[], limit: number): string {
  if (entries.length === 0) return `${title}:\n  (none)`
  const shown = entries.slice(0, limit)
  const omitted = entries.length - shown.length
  const rows = shown.map((entry) => `  ${entry}`).join('\n')
  return `${title} (${entries.length}):\n${rows}${omitted > 0 ? `\n  [${omitted} more omitted]` : ''}`
}
