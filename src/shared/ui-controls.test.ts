import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { UI_CONTROLS, uiControlFamilies } from './ui-controls.ts'

const ROOTS = ['src/renderer', 'src/components']
const ID = /\b(?:data-ui|control)="([a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)"/g
/** data-ui={`view.${kind}`}: the family is fixed and the name comes from a typed value. */
const TEMPLATED = /\bdata-ui=\{`([a-z][a-z0-9-]*)\.\$\{/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : []
  })
}

function renderedIds(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of ROOTS.flatMap(sourceFiles)) {
    for (const match of readFileSync(file, 'utf8').matchAll(ID)) {
      found.set(match[1]!, [...(found.get(match[1]!) ?? []), file])
    }
  }
  return found
}

test('every rendered data-ui id is declared in the manifest', () => {
  const undeclared = [...renderedIds()].filter(([id]) => !(id in UI_CONTROLS))
  assert.deepEqual(undeclared, [])
})

function templatedFamilies(): Set<string> {
  return new Set(ROOTS.flatMap(sourceFiles).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(TEMPLATED)].map((match) => match[1]!)))
}

test('every manifest id is rendered somewhere', () => {
  const rendered = renderedIds()
  const families = templatedFamilies()
  const unused = Object.keys(UI_CONTROLS).filter((id) => !rendered.has(id) && !families.has(id.split('.')[0]!))
  assert.deepEqual(unused, [])
})

test('families are derived from ids', () => {
  const families = uiControlFamilies()
  assert.ok(families.includes('composer'))
  assert.ok(families.includes('titlebar'))
  assert.ok(families.every((family) => !family.includes('.')))
})
